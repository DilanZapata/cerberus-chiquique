import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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

// Todo configurable en un solo lugar, tal como se pidio.
const PROBE_INTERVAL_MS = 1200; // cada cuanto se toma una foto liviana para sondear si hay alguien
const STABILITY_THRESHOLD = 2; // sondeos consecutivos de la MISMA persona antes de capturar de verdad
const RESULT_DISPLAY_MS = 3500; // cuanto se muestra el resultado (exito/rechazo/error) en pantalla
const COOLDOWN_MS = 2500; // pausa corta tras mostrar el resultado antes de reanudar la deteccion

type KioskState = 'INITIALIZING' | 'READY' | 'DETECTING' | 'CAPTURING' | 'PROCESSING' | 'SUCCESS' | 'REJECTED' | 'ERROR' | 'COOLDOWN';
type ResultTone = 'success' | 'warning' | 'error';

type Props = NativeStackScreenProps<RootStackParamList, 'Kiosk'>;

async function getCurrentCoords(): Promise<{ latitude: number; longitude: number }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Se necesita permiso de ubicacion para identificar la sede de este kiosco.');
  }
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude };
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
 * Modo Kiosco: pantalla principal de la app (terminal fija compartida). La
 * camara analiza continuamente buscando un rostro (sondeo periodico contra
 * `/kiosk/face-probe`, que solo identifica sin registrar nada) y, cuando
 * detecta la MISMA persona de forma estable durante `STABILITY_THRESHOLD`
 * sondeos seguidos, captura automaticamente y registra la marca real via
 * `/kiosk/face-clock` (sujeto al guard de duplicados de 5 minutos del
 * backend). El PIN queda como respaldo secundario, y el login personal
 * como boton discreto en la esquina.
 */
export default function KioskScreen({ navigation }: Props) {
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [kioskState, setKioskState] = useState<KioskState>('INITIALIZING');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [resultTone, setResultTone] = useState<ResultTone | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showPinMode, setShowPinMode] = useState(false);

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
      setResultMessage(`${result.fullName}: ${LOG_TYPE_LABELS[result.logType]} a las ${new Date(result.loggedAt).toLocaleTimeString()}`);
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

  // ---- Modo PIN (respaldo) ----
  const [employeeCode, setEmployeeCode] = useState('');
  const [pin, setPin] = useState('');
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);

  function pressDigit(digit: string) {
    if (pin.length < 6) setPin(pin + digit);
  }

  async function submitPin() {
    setPinLoading(true);
    setPinError(null);
    setPinMessage(null);
    try {
      const coords = await getCurrentCoords();
      let imageBase64: string | undefined;
      if (permission?.granted && cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
        if (photo?.base64) imageBase64 = `data:image/jpeg;base64,${photo.base64}`;
      }
      const result = await kioskClock({ ...coords, employeeCode, pin, imageBase64 });
      setPinMessage(`${result.fullName}: ${LOG_TYPE_LABELS[result.logType]} a las ${new Date(result.loggedAt).toLocaleTimeString()}`);
      setEmployeeCode('');
      setPin('');
    } catch (err) {
      setPinError((err as Error).message);
    } finally {
      setPinLoading(false);
    }
  }

  // ---- Render ----

  if (showPinMode) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.pinContainer}>
          <TouchableOpacity style={styles.backLink} onPress={() => setShowPinMode(false)}>
            <Text style={styles.backLinkText}>‹ Volver al reconocimiento facial</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Marcar con codigo y PIN</Text>

          {permission?.granted && (
            <View style={styles.cameraBoxSmall}>
              <CameraView ref={cameraRef} style={styles.camera} facing="front" />
            </View>
          )}

          <TextInput
            style={styles.input}
            placeholder="Codigo de empleado"
            value={employeeCode}
            onChangeText={setEmployeeCode}
            autoCapitalize="characters"
          />
          <Text style={styles.pinDisplay}>{'•'.repeat(pin.length) || 'PIN'}</Text>
          <View style={styles.keypad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) => (
              <TouchableOpacity
                key={i}
                style={styles.key}
                disabled={!key}
                onPress={() => (key === '⌫' ? setPin(pin.slice(0, -1)) : pressDigit(key))}
              >
                <Text style={styles.keyText}>{key}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {pinError && <Text style={styles.error}>{pinError}</Text>}
          {pinMessage && <Text style={styles.success}>{pinMessage}</Text>}

          <TouchableOpacity style={styles.submit} onPress={submitPin} disabled={pinLoading || !employeeCode || !pin}>
            {pinLoading ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Marcar</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
      <TouchableOpacity style={styles.loginCorner} onPress={() => navigation.navigate('Login')}>
        <Text style={styles.loginCornerText}>Iniciar sesion</Text>
      </TouchableOpacity>

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

        <TouchableOpacity style={styles.pinLink} onPress={() => setShowPinMode(true)}>
          <Text style={styles.pinLinkText}>Usar codigo y PIN</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  loginCorner: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 10,
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  loginCornerText: { color: '#334155', fontWeight: '600', fontSize: 12 },
  faceContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 13, color: '#475569', textAlign: 'center', marginBottom: 8 },
  cameraBox: { width: 260, height: 260, borderRadius: 130, overflow: 'hidden', backgroundColor: '#000', borderWidth: 4 },
  cameraBoxSmall: { width: 90, height: 90, borderRadius: 45, overflow: 'hidden', backgroundColor: '#000' },
  camera: { width: '100%', height: '100%' },
  statusLabel: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginTop: 12 },
  statusDetail: { fontSize: 12, color: '#475569', textAlign: 'center' },
  resultText: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  errorBox: { alignItems: 'center', gap: 8 },
  error: { color: '#b91c1c', textAlign: 'center' },
  warning: { color: '#b45309', textAlign: 'center' },
  success: { color: '#047857', textAlign: 'center' },
  submit: { marginTop: 12, backgroundColor: '#0f172a', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8 },
  submitDisabled: { backgroundColor: '#94a3b8' },
  submitText: { color: 'white', fontWeight: '700', fontSize: 16 },
  pinLink: { marginTop: 20, padding: 8 },
  pinLinkText: { color: '#64748b', fontSize: 12, textDecorationLine: 'underline' },
  // ---- Modo PIN ----
  pinContainer: { flexGrow: 1, alignItems: 'center', padding: 24, gap: 10 },
  backLink: { alignSelf: 'flex-start' },
  backLinkText: { color: '#0f172a', fontWeight: '600', fontSize: 15 },
  input: { width: '100%', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, fontSize: 14 },
  pinDisplay: { fontSize: 28, letterSpacing: 8, marginVertical: 8 },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', width: 240, justifyContent: 'center' },
  key: { width: 72, height: 56, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 22, fontWeight: '600' },
});
