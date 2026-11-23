import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { ApiError, kioskClock, kioskFaceClock, kioskFaceProbe } from '../services/api';

const LOG_TYPE_LABELS: Record<string, string> = {
  CHECK_IN: 'Entrada registrada',
  LUNCH_OUT: 'Salida a almuerzo registrada',
  LUNCH_IN: 'Reingreso de almuerzo registrado',
  CHECK_OUT: 'Salida registrada',
};

// Turno de noche manejado por dia: la pausa entre los dos bloques es un descanso, no un almuerzo.
const REST_BREAK_LABELS: Record<string, string> = {
  LUNCH_OUT: 'Salida a descanso registrada',
  LUNCH_IN: 'Entrada de descanso registrada',
};

function markLabel(result: { logType: string; breakIsRest?: boolean }): string {
  return (result.breakIsRest ? REST_BREAK_LABELS[result.logType] : undefined) ?? LOG_TYPE_LABELS[result.logType];
}

// Todo configurable en un solo lugar, tal como se pidio.
const PROBE_INTERVAL_MS = 1200; // cada cuanto se toma una foto liviana para sondear si hay alguien
const STABILITY_THRESHOLD = 2; // sondeos consecutivos de la MISMA persona antes de capturar de verdad
const RESULT_DISPLAY_MS = 3500; // cuanto se muestra el resultado (exito/rechazo/error) en pantalla
const COOLDOWN_MS = 2500; // pausa corta tras mostrar el resultado antes de reanudar la deteccion

type KioskState = 'INITIALIZING' | 'READY' | 'DETECTING' | 'CAPTURING' | 'PROCESSING' | 'SUCCESS' | 'REJECTED' | 'ERROR' | 'COOLDOWN';
type ResultTone = 'success' | 'warning' | 'error';

type Props = NativeStackScreenProps<RootStackParamList, 'Kiosk'>;

const MAX_IDENTIFIER_LENGTH = 20;
// Teclado en pantalla del kiosco: botones grandes y siempre visibles, sin
// que el teclado del telefono tape la camara ni mueva la pantalla.
const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['ABC', '0', 'DEL'],
];
const PIN_RESULT_VISIBLE_MS = 7000; // cuanto queda en pantalla el resultado del registro por cedula/codigo/PIN
const LOCATION_TIMEOUT_MS = 12000; // tope de espera por una posicion GPS nueva
const LOCATION_CACHE_MS = 2 * 60_000; // el kiosco es una terminal fija: la ultima posicion sirve un rato
const LOCATION_REFRESH_MS = 90_000; // cada cuanto se refresca la posicion en segundo plano

type Coords = { latitude: number; longitude: number };
let cachedCoords: { coords: Coords; at: number } | null = null;

/**
 * Ubicacion del kiosco. Pedir una posicion GPS nueva puede tardar varios
 * segundos (o no llegar nunca bajo techo), y eso dejaba el boton
 * "Registrar" cargando sin responder. Por eso: se reutiliza la ultima
 * posicion durante un par de minutos, la espera tiene tope, y si no llega
 * una posicion nueva se usa la ultima conocida del telefono.
 */
async function getCurrentCoords(): Promise<Coords> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Se necesita permiso de ubicacion para identificar la sede de este kiosco.');
  }
  if (cachedCoords && Date.now() - cachedCoords.at < LOCATION_CACHE_MS) return cachedCoords.coords;
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('La ubicacion (GPS) del dispositivo esta apagada. Enciendela e intenta de nuevo.');
  }

  const fresh = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS)),
  ]);
  const position = fresh ?? (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null));
  if (!position) {
    throw new Error('No se pudo obtener la ubicacion. Verifica que el GPS este encendido e intenta de nuevo.');
  }
  const coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
  cachedCoords = { coords, at: Date.now() };
  return coords;
}

const FRAME_COLOR: Record<KioskState, string> = {
  INITIALIZING: '#cbd5e1',
  READY: '#cbd5e1',
  DETECTING: '#3b82f6',
  CAPTURING: '#3b82f6',
  PROCESSING: '#f59e0b',
  SUCCESS: '#059669',
  REJECTED: '#d97706',
  ERROR: '#dc2626',
  COOLDOWN: '#cbd5e1',
};

const STATUS_LABEL: Record<KioskState, string> = {
  INITIALIZING: 'Preparando camara...',
  READY: 'Buscando rostro...',
  DETECTING: 'Buscando rostro...',
  CAPTURING: 'Rostro detectado, capturando...',
  PROCESSING: 'Validando informacion...',
  SUCCESS: 'Registro exitoso',
  REJECTED: 'No fue posible validar el registro',
  ERROR: 'Ocurrio un problema',
  COOLDOWN: 'Preparando el siguiente registro...',
};

/**
 * Modo Kiosco: pantalla principal de la app (terminal fija compartida,
 * pensada para operarse en una tablet). Por defecto se abre en modo
 * identificador: la persona ve claramente su propia camara en un recuadro
 * cuadrado grande (para confirmar que la foto de evidencia va a salir bien
 * antes de tomarla), digita UN SOLO VALOR -- su CEDULA, su CODIGO DE
 * EMPLEADO, O su PIN, cualquiera de los tres (el backend prueba los tres,
 * ver KioskService.identifyByCodeOrPin) -- y registra; la foto se toma en
 * ese momento como evidencia, sin necesidad de reconocer a nadie. El
 * reconocimiento facial automatico
 * (sondeo periodico contra `/kiosk/face-probe` y captura sola al detectar
 * estabilidad) sigue disponible como modo alternativo, y el login personal
 * como boton discreto en la esquina.
 */
export default function KioskScreen({}: Props) {
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  // Todo en modo codigo/PIN debe caber en una sola pantalla, SIN scroll, en
  // cualquier dispositivo (telefono chico o tablet) -- por eso el tamano de
  // la camara se calcula en proporcion a la pantalla real en vez de usar un
  // valor fijo pensado solo para tablet.
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const isCompact = screenHeight < 700;
  const pinCameraSize = Math.round(Math.min(screenHeight * (isCompact ? 0.14 : 0.18), screenWidth * 0.36, 140));
  // Alto de cada tecla del teclado en pantalla: lo que sobra de la pantalla
  // (titulo, camara, campo, resultado y boton ya descontados) entre 4 filas.
  const keypadKeyHeight = Math.max(40, Math.min(64, Math.floor((screenHeight - 350 - pinCameraSize) / 4) - 8));

  const [kioskState, setKioskState] = useState<KioskState>('INITIALIZING');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [resultTone, setResultTone] = useState<ResultTone | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showPinMode, setShowPinMode] = useState(true);

  // Todo lo que decide el flujo (no solo lo visual) vive en refs: un
  // candado de proceso real que se revisa ANTES de disparar cualquier
  // captura, no solo un boton deshabilitado.
  const isProcessingRef = useRef(false);
  const isFocusedRef = useRef(isFocused);
  const stableMatchRef = useRef<{ fullName: string; count: number } | null>(null);
  const coordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  // Se pide el permiso de camara de una vez al abrir, sin esperar a que la
  // persona entre al modo reconocimiento facial -- el modo PIN (ahora el
  // que se ve primero) tambien necesita la camara para el recuadro de
  // evidencia, y no tiene su propio boton de "permitir camara".
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.granted, permission?.canAskAgain]);

  function clearAllTimers() {
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    if (cooldownTimeoutRef.current) clearTimeout(cooldownTimeoutRef.current);
    pollTimeoutRef.current = null;
    resultTimeoutRef.current = null;
    cooldownTimeoutRef.current = null;
  }

  function scheduleNextProbe(delayMs: number) {
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    pollTimeoutRef.current = setTimeout(runProbeTick, delayMs);
  }

  /** Un solo sondeo: toma una foto liviana, pregunta quien es (sin registrar nada), y decide si ya hay estabilidad suficiente para capturar de verdad. */
  async function runProbeTick() {
    if (!isFocusedRef.current || isProcessingRef.current || showPinMode || !cameraRef.current || !coordsRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.3 });
      if (isProcessingRef.current || !isFocusedRef.current) return; // pudo cambiar mientras se tomaba la foto
      if (!photo?.base64) {
        stableMatchRef.current = null;
        setKioskState('DETECTING');
        setStatusDetail(null);
        scheduleNextProbe(PROBE_INTERVAL_MS);
        return;
      }

      const result = await kioskFaceProbe({ ...coordsRef.current, imageBase64: `data:image/jpeg;base64,${photo.base64}` });
      if (isProcessingRef.current || !isFocusedRef.current) return;

      if (result.recognized && result.fullName) {
        if (stableMatchRef.current?.fullName === result.fullName) {
          stableMatchRef.current.count += 1;
        } else {
          stableMatchRef.current = { fullName: result.fullName, count: 1 };
        }
        setKioskState('DETECTING');
        setStatusDetail(`Rostro detectado: ${result.fullName}. Mantente frente a la camara...`);

        if (stableMatchRef.current.count >= STABILITY_THRESHOLD) {
          stableMatchRef.current = null;
          await captureAndCommit();
          return; // captureAndCommit ya se encarga de reanudar el sondeo cuando corresponda
        }
      } else {
        stableMatchRef.current = null;
        setKioskState('DETECTING');
        setStatusDetail(null);
      }
    } catch {
      // Fallo de red/temporal en el sondeo: no es una condicion de error
      // para el usuario, simplemente se sigue buscando en el proximo ciclo.
      stableMatchRef.current = null;
    }

    scheduleNextProbe(PROBE_INTERVAL_MS);
  }

  /**
   * Funcion UNICA de captura+registro, usada tanto por la deteccion
   * automatica (al llegar a la estabilidad requerida) como por el boton
   * manual -- exactamente las mismas reglas de seguridad para ambas.
   * El candado `isProcessingRef` se activa aqui y solo se libera cuando el
   * flujo vuelve a READY (incluye el tiempo de mostrar el resultado y el
   * cooldown), nunca antes.
   */
  async function captureAndCommit() {
    if (isProcessingRef.current || !cameraRef.current || !coordsRef.current) return;

    isProcessingRef.current = true;
    setIsProcessing(true);
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    setKioskState('CAPTURING');
    setResultMessage(null);
    setResultTone(null);

    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      if (!photo?.base64) throw new Error('No se pudo tomar la foto.');

      setKioskState('PROCESSING');
      const result = await kioskFaceClock({ ...coordsRef.current, imageBase64: `data:image/jpeg;base64,${photo.base64}` });
      setResultTone('success');
      setResultMessage(`${result.fullName}: ${markLabel(result)} a las ${new Date(result.loggedAt).toLocaleTimeString()}`);
      setKioskState('SUCCESS');
    } catch (err) {
      if (err instanceof ApiError) {
        setResultTone('warning');
        setResultMessage(err.message);
        setKioskState('REJECTED');
      } else {
        setResultTone('error');
        setResultMessage((err as Error).message || 'No se pudo conectar con el servidor. Intenta de nuevo.');
        setKioskState('ERROR');
      }
    }

    scheduleReturnToReady();
  }

  /** Muestra el resultado un tiempo breve, pasa por un cooldown corto, y solo ENTONCES libera el candado real y reanuda la deteccion. */
  function scheduleReturnToReady() {
    resultTimeoutRef.current = setTimeout(() => {
      setKioskState('COOLDOWN');
      cooldownTimeoutRef.current = setTimeout(() => {
        isProcessingRef.current = false;
        setIsProcessing(false);
        stableMatchRef.current = null;
        setResultMessage(null);
        setResultTone(null);
        setStatusDetail(null);
        if (isFocusedRef.current && !showPinMode) {
          setKioskState('READY');
          scheduleNextProbe(0);
        }
      }, COOLDOWN_MS);
    }, RESULT_DISPLAY_MS);
  }

  /** Respaldo manual: misma funcion de captura+registro, mismo candado -- solo se dispara si nada esta en proceso. */
  function handleManualCapture() {
    if (isProcessingRef.current) return;
    captureAndCommit();
  }

  async function initialize() {
    setKioskState('INITIALIZING');
    setLocationError(null);
    try {
      const coords = await getCurrentCoords();
      coordsRef.current = coords;
      setKioskState('READY');
      scheduleNextProbe(0);
    } catch (err) {
      coordsRef.current = null;
      setLocationError((err as Error).message);
      setKioskState('ERROR');
    }
  }

  // Ciclo de vida de la camara: solo se inicializa/sondea mientras la
  // pantalla esta enfocada y en modo rostro. Al perder foco (ej. se navego
  // a Login) se limpian los timers y se libera el candado -- al volver, se
  // reinicializa desde cero (nueva ubicacion, nuevo ciclo), sin instancias
  // duplicadas de camara ni sondeos huerfanos corriendo en segundo plano.
  useEffect(() => {
    if (!isFocused || !permission?.granted || showPinMode) {
      clearAllTimers();
      isProcessingRef.current = false;
      setIsProcessing(false);
      stableMatchRef.current = null;
      return;
    }
    initialize();
    return () => {
      clearAllTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, permission?.granted, showPinMode]);

  // ---- Modo codigo/PIN (respaldo): UN solo campo -- cedula, codigo de
  // empleado, O PIN, cualquiera de los tres identifica (a peticion
  // explicita, ya no se exige cedula/codigo + PIN juntos). ----
  const [identifier, setIdentifier] = useState('');
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  // Por defecto se digita con los numeros de la propia pantalla (cedula y
  // PIN). "ABC" abre el teclado del telefono, solo para codigos con letras.
  const [lettersKeyboard, setLettersKeyboard] = useState(false);
  const pinSubmittingRef = useRef(false);
  const pinResultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mientras el kiosco esta en esta pantalla, la ubicacion se va refrescando
  // sola: asi al tocar "Registrar" ya esta lista y la marca sale al instante.
  useEffect(() => {
    if (!isFocused || !showPinMode) return;
    const refresh = () => {
      getCurrentCoords().catch(() => undefined); // si falla, el error se muestra al registrar
    };
    refresh();
    const interval = setInterval(refresh, LOCATION_REFRESH_MS);
    return () => clearInterval(interval);
  }, [isFocused, showPinMode]);

  useEffect(() => {
    return () => {
      if (pinResultTimeoutRef.current) clearTimeout(pinResultTimeoutRef.current);
    };
  }, []);

  function dismissPinError() {
    setPinError(null);
  }

  function toggleKeyboard() {
    Keyboard.dismiss();
    setLettersKeyboard((current) => !current);
  }

  function pressKey(key: string) {
    if (pinLoading) return;
    if (key === 'ABC') return toggleKeyboard();
    if (key === 'DEL') return setIdentifier((current) => current.slice(0, -1));
    setIdentifier((current) => (current.length >= MAX_IDENTIFIER_LENGTH ? current : current + key));
  }

  async function submitPin() {
    const value = identifier.trim();
    // Candado real contra el doble toque (el boton deshabilitado tarda un render en aplicar).
    if (!value || pinSubmittingRef.current) return;
    pinSubmittingRef.current = true;
    if (pinResultTimeoutRef.current) clearTimeout(pinResultTimeoutRef.current);
    Keyboard.dismiss(); // que el teclado no tape el resultado
    setPinLoading(true);
    setPinError(null);
    setPinMessage(null);
    try {
      // Para registrar debe verse el rostro: el servidor lo busca en la foto y
      // lo compara con el rostro enrolado de quien digito su cedula/codigo.
      if (!permission?.granted || !cameraRef.current) {
        throw new Error('Se necesita la camara para registrar. Toca "Permitir" en el recuadro de la camara.');
      }
      // La ubicacion (ya lista en segundo plano) y la foto se piden a la vez.
      const [coords, photo] = await Promise.all([
        getCurrentCoords(),
        cameraRef.current.takePictureAsync({ base64: true, quality: 0.4 }).catch(() => null),
      ]);
      if (!photo?.base64) throw new Error('No se pudo tomar la foto. Mira a la camara e intenta de nuevo.');
      const result = await kioskClock({ ...coords, identifier: value, imageBase64: `data:image/jpeg;base64,${photo.base64}` });
      setPinMessage(
        `${result.fullName}: ${markLabel(result)} a las ${new Date(result.loggedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`,
      );
      setIdentifier('');
    } catch (err) {
      setPinError((err as Error).message || 'No se pudo registrar. Intenta de nuevo.');
    } finally {
      setPinLoading(false);
      pinSubmittingRef.current = false;
      // El resultado no se queda pegado para la siguiente persona.
      pinResultTimeoutRef.current = setTimeout(() => {
        setPinMessage(null);
        setPinError(null);
      }, PIN_RESULT_VISIBLE_MS);
    }
  }

  // ---- Render ----

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
      {!showPinMode && (
        <TouchableOpacity style={styles.backCorner} onPress={() => setShowPinMode(true)}>
          <Text style={styles.backCornerText}>‹ Codigo y PIN</Text>
        </TouchableOpacity>
      )}

      {showPinMode ? (
        <KeyboardAvoidingView
          style={styles.pinContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <View style={styles.pinHeader}>
            <Text style={styles.titleCompact}>Cerberus</Text>
            <Text style={styles.subtitleCompact}>Mira a la camara y digita tu cedula, tu codigo o tu PIN</Text>
          </View>

          {permission?.granted ? (
            <View style={[styles.cameraBoxSquare, { width: pinCameraSize, height: pinCameraSize }]}>
              {isFocused && <CameraView ref={cameraRef} style={styles.camera} facing="front" />}
            </View>
          ) : (
            <View style={[styles.cameraBoxSquare, styles.cameraBoxPlaceholder, { width: pinCameraSize, height: pinCameraSize }]}>
              <Text style={styles.cameraPlaceholderText}>Se necesita la camara</Text>
              <TouchableOpacity style={styles.submitSmall} onPress={requestPermission}>
                <Text style={styles.submitText}>Permitir</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.pinFormColumn}>
            <View style={styles.fieldLabelRow}>
              <Text style={styles.fieldLabel}>Cedula, codigo de empleado o PIN</Text>
              {lettersKeyboard && (
                <TouchableOpacity style={styles.keyboardToggle} onPress={toggleKeyboard} hitSlop={8} accessibilityLabel="Volver a los numeros">
                  <Text style={styles.keyboardToggleText}>123</Text>
                </TouchableOpacity>
              )}
            </View>

            {lettersKeyboard ? (
              // Solo para codigos con letras ("ADM001"): teclado del telefono.
              <TextInput
                style={styles.inputCompact}
                placeholder="Escribe tu codigo"
                placeholderTextColor="#94a3b8"
                value={identifier}
                onChangeText={setIdentifier}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                maxLength={MAX_IDENTIFIER_LENGTH}
                returnKeyType="done"
                onSubmitEditing={submitPin}
              />
            ) : (
              <>
                <View style={styles.display} accessible accessibilityLabel={identifier ? `Digitado: ${identifier}` : 'Nada digitado aun'}>
                  <Text style={identifier ? styles.displayValue : styles.displayPlaceholder} numberOfLines={1} adjustsFontSizeToFit>
                    {identifier || 'Digita con los numeros de abajo'}
                  </Text>
                </View>
                <View style={styles.keypad}>
                  {KEYPAD_ROWS.map((row) => (
                    <View key={row.join('')} style={styles.keypadRow}>
                      {row.map((key) => {
                        const isAction = key === 'ABC' || key === 'DEL';
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[styles.key, { height: keypadKeyHeight }, isAction && styles.keyAction]}
                            activeOpacity={0.6}
                            onPress={() => pressKey(key)}
                            onLongPress={key === 'DEL' ? () => setIdentifier('') : undefined}
                            accessibilityLabel={key === 'DEL' ? 'Borrar' : key === 'ABC' ? 'Usar teclado de letras' : key}
                          >
                            <Text style={isAction ? styles.keyActionText : styles.keyText}>{key === 'DEL' ? 'Borrar' : key}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>

          <View style={styles.pinFooter}>
            {/* Espacio reservado: el resultado aparece sin mover el teclado ni el boton. */}
            <View style={styles.pinResultSlot}>
              {pinMessage && (
                <Text style={[styles.success, styles.pinSuccessStrong]} numberOfLines={2}>
                  {pinMessage}
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={styles.submitCompact}
              onPress={submitPin}
              disabled={pinLoading || !identifier.trim()}
            >
              {pinLoading ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Registrar</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.pinLink} onPress={() => setShowPinMode(false)}>
              <Text style={styles.pinLinkText}>Usar reconocimiento facial</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.faceContainer}>
          <Text style={styles.title}>Cerberus</Text>
          <Text style={styles.subtitle}>Ubicate frente a la camara para marcar tu asistencia</Text>

          {!permission?.granted ? (
            <TouchableOpacity style={styles.submit} onPress={requestPermission}>
              <Text style={styles.submitText}>Permitir uso de la camara</Text>
            </TouchableOpacity>
          ) : locationError ? (
            <View style={styles.errorBox}>
              <Text style={styles.error}>{locationError}</Text>
              <TouchableOpacity style={styles.submit} onPress={initialize}>
                <Text style={styles.submitText}>Reintentar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={[styles.cameraBox, { borderColor: FRAME_COLOR[kioskState] }]}>
                {isFocused && <CameraView ref={cameraRef} style={styles.camera} facing="front" />}
              </View>

              <Text style={styles.statusLabel}>{STATUS_LABEL[kioskState]}</Text>
              {statusDetail && kioskState === 'DETECTING' && <Text style={styles.statusDetail}>{statusDetail}</Text>}
              {resultMessage && (
                <Text
                  style={[
                    styles.resultText,
                    resultTone === 'success' && styles.success,
                    resultTone === 'warning' && styles.warning,
                    resultTone === 'error' && styles.error,
                  ]}
                >
                  {resultMessage}
                </Text>
              )}

              <TouchableOpacity style={[styles.submit, isProcessing && styles.submitDisabled]} onPress={handleManualCapture} disabled={isProcessing}>
                {kioskState === 'CAPTURING' || kioskState === 'PROCESSING' ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.submitText}>Capturar manualmente</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
      {/* Los errores del registro salen como una alerta grande al centro de la
          pantalla: imposible no verla. Se cierra con el boton o sola a los
          pocos segundos, para que no le quede abierta a la siguiente persona. */}
      <Modal visible={pinError !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={dismissPinError}>
        <View style={styles.alertBackdrop}>
          <View style={styles.alertCard} accessibilityRole="alert">
            <View style={styles.alertIcon}>
              <Text style={styles.alertIconText}>!</Text>
            </View>
            <Text style={styles.alertTitle}>No se pudo registrar</Text>
            <Text style={styles.alertMessage}>{pinError}</Text>
            <TouchableOpacity style={styles.alertButton} onPress={dismissPinError}>
              <Text style={styles.alertButtonText}>Entendido</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  backCorner: {
    position: 'absolute',
    top: 12,
    left: 16,
    zIndex: 10,
    elevation: 10,
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  backCornerText: { color: '#334155', fontWeight: '600', fontSize: 12 },
  faceContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 13, color: '#475569', textAlign: 'center', marginBottom: 8 },
  cameraBox: { width: 260, height: 260, borderRadius: 130, overflow: 'hidden', backgroundColor: '#000', borderWidth: 4 },
  cameraBoxSquare: { width: 260, height: 260, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  cameraBoxPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 },
  cameraPlaceholderText: { color: '#cbd5e1', fontSize: 12, textAlign: 'center' },
  cameraHint: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 6 },
  camera: { width: '100%', height: '100%' },
  statusLabel: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginTop: 12 },
  statusDetail: { fontSize: 12, color: '#475569', textAlign: 'center' },
  resultText: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  errorBox: { alignItems: 'center', gap: 8 },
  error: { color: '#b91c1c', textAlign: 'center' },
  warning: { color: '#b45309', textAlign: 'center' },
  success: { color: '#047857', textAlign: 'center' },
  submit: { marginTop: 12, backgroundColor: '#0f172a', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8 },
  submitSmall: { backgroundColor: '#0f172a', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  submitDisabled: { backgroundColor: '#94a3b8' },
  submitText: { color: 'white', fontWeight: '700', fontSize: 16 },
  pinLink: { marginTop: 4, padding: 4 },
  pinLinkText: { color: '#64748b', fontSize: 11, textDecorationLine: 'underline' },
  // ---- Modo codigo/PIN: TODO debe caber en una sola pantalla, sin scroll
  // -- por eso el contenedor reparte el espacio disponible con
  // `justifyContent: 'space-evenly'` en vez de apilar con margenes fijos
  // (que es lo que obligaba a hacer scroll en pantallas chicas). ----
  pinContainer: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 20, paddingVertical: 10 },
  pinHeader: { alignItems: 'center', gap: 2 },
  titleCompact: { fontSize: 18, fontWeight: '700' },
  subtitleCompact: { fontSize: 11, color: '#475569', textAlign: 'center', paddingHorizontal: 8 },
  // Campo + teclado numerico en pantalla. El campo se ve como un campo de
  // verdad (borde, texto de ayuda, lo digitado en grande) para que quede
  // claro para que es y se vea lo que se va escribiendo.
  pinFormColumn: { width: '100%', maxWidth: 380, gap: 6 },
  display: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#94a3b8',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
  },
  displayValue: { fontSize: 24, fontWeight: '700', color: '#0f172a', letterSpacing: 2 },
  displayPlaceholder: { fontSize: 14, color: '#94a3b8' },
  keypad: { width: '100%', gap: 8, marginTop: 2 },
  keypadRow: { flexDirection: 'row', gap: 8 },
  key: { flex: 1, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  keyAction: { backgroundColor: '#e2e8f0', borderColor: '#e2e8f0' },
  keyActionText: { fontSize: 14, fontWeight: '700', color: '#334155' },
  fieldLabel: { fontSize: 11, color: '#64748b', marginBottom: 2, fontWeight: '600' },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  keyboardToggle: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8, backgroundColor: 'white' },
  keyboardToggleText: { fontSize: 11, fontWeight: '700', color: '#334155' },
  inputCompact: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    backgroundColor: '#fff',
    // Fijo a propósito: la app sigue el tema del sistema
    // (userInterfaceStyle "automatic" en app.json), y sin esto el texto
    // escrito hereda el color claro del modo oscuro -- casi invisible
    // sobre el fondo blanco del campo.
    color: '#0f172a',
  },
  pinFooter: { alignItems: 'center', gap: 4, width: '100%' },
  alertBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  alertCard: { width: '100%', maxWidth: 380, backgroundColor: 'white', borderRadius: 16, padding: 24, alignItems: 'center', gap: 10 },
  alertIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  alertIconText: { fontSize: 30, fontWeight: '800', color: '#b91c1c' },
  alertTitle: { fontSize: 19, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  alertMessage: { fontSize: 16, color: '#334155', textAlign: 'center', lineHeight: 22 },
  alertButton: { marginTop: 8, backgroundColor: '#0f172a', paddingVertical: 14, borderRadius: 10, alignSelf: 'stretch', alignItems: 'center' },
  alertButtonText: { color: 'white', fontWeight: '700', fontSize: 16 },
  pinResultSlot: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 8 },
  pinSuccessStrong: { fontWeight: '700', fontSize: 15 },
  submitCompact: { backgroundColor: '#0f172a', paddingVertical: 10, paddingHorizontal: 28, borderRadius: 8 },
});
