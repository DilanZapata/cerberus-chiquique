import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { kioskClock, kioskFaceClock } from '../services/api';

const LOG_TYPE_LABELS: Record<string, string> = {
  CHECK_IN: 'Entrada registrada',
  LUNCH_OUT: 'Salida a almuerzo registrada',
  LUNCH_IN: 'Reingreso de almuerzo registrado',
  CHECK_OUT: 'Salida registrada',
};

type Mode = 'PIN' | 'FACE';

type Props = NativeStackScreenProps<RootStackParamList, 'Kiosk'>;

async function getCurrentCoords(): Promise<{ latitude: number; longitude: number }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Se necesita permiso de ubicacion para identificar la sede de este kiosco.');
  }
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude };
}

/**
 * Modo Kiosco: terminal fija instalada en el punto de trabajo. No requiere
 * ninguna configuracion previa del dispositivo (ni token ni sede): el
 * backend identifica la sede (y la empresa) por la ubicacion GPS actual del
 * telefono, el mismo mecanismo de geocerca que usa el marcaje de
 * autoservicio movil. El empleado se identifica con su codigo + PIN, o con
 * su rostro. En ambos modos se guarda una foto de evidencia junto con la marca.
 */
export default function KioskScreen({ navigation }: Props) {
  const [mode, setMode] = useState<Mode>('PIN');
  const [employeeCode, setEmployeeCode] = useState('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  function pressDigit(digit: string) {
    if (pin.length < 6) setPin(pin + digit);
  }

  async function submitPin() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const coords = await getCurrentCoords();
      // Foto de evidencia: si la camara esta lista, se toma una captura
      // silenciosa al momento de marcar (no identifica a nadie, solo queda
      // como respaldo de que la marca se hizo en persona).
      let imageBase64: string | undefined;
      if (permission?.granted && cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
        if (photo?.base64) imageBase64 = `data:image/jpeg;base64,${photo.base64}`;
      }
      const result = await kioskClock({ ...coords, employeeCode, pin, imageBase64 });
      setMessage(`${result.fullName}: ${LOG_TYPE_LABELS[result.logType]} a las ${new Date(result.loggedAt).toLocaleTimeString()}`);
      setEmployeeCode('');
      setPin('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function captureAndSubmitFace() {
    if (!cameraRef.current) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const coords = await getCurrentCoords();
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      if (!photo?.base64) throw new Error('No se pudo capturar la foto.');
      const result = await kioskFaceClock({ ...coords, imageBase64: `data:image/jpeg;base64,${photo.base64}` });
      setMessage(`${result.fullName}: ${LOG_TYPE_LABELS[result.logType]} a las ${new Date(result.loggedAt).toLocaleTimeString()}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity style={styles.backLink} onPress={() => navigation.navigate('SelectMode')}>
        <Text style={styles.backLinkText}>‹ Volver</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Marcador Kiosco</Text>

      <View style={styles.modeSwitch}>
        <TouchableOpacity style={[styles.modeButton, mode === 'PIN' && styles.modeButtonActive]} onPress={() => setMode('PIN')}>
          <Text style={[styles.modeButtonText, mode === 'PIN' && styles.modeButtonTextActive]}>PIN</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modeButton, mode === 'FACE' && styles.modeButtonActive]} onPress={() => setMode('FACE')}>
          <Text style={[styles.modeButtonText, mode === 'FACE' && styles.modeButtonTextActive]}>Rostro</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />

      {mode === 'PIN' ? (
        <>
          {!permission?.granted && (
            <TouchableOpacity style={styles.photoHint} onPress={requestPermission}>
              <Text style={styles.photoHintText}>Permitir camara (foto de evidencia junto a la marca)</Text>
            </TouchableOpacity>
          )}
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

          {error && <Text style={styles.error}>{error}</Text>}
          {message && <Text style={styles.success}>{message}</Text>}

          <TouchableOpacity style={styles.submit} onPress={submitPin} disabled={loading || !employeeCode || !pin}>
            {loading ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Marcar</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          {!permission?.granted ? (
            <TouchableOpacity style={styles.submit} onPress={requestPermission}>
              <Text style={styles.submitText}>Permitir uso de la camara</Text>
            </TouchableOpacity>
          ) : (
            <>
              <View style={styles.cameraBox}>
                <CameraView ref={cameraRef} style={styles.camera} facing="front" />
              </View>

              {error && <Text style={styles.error}>{error}</Text>}
              {message && <Text style={styles.success}>{message}</Text>}

              <TouchableOpacity style={styles.submit} onPress={captureAndSubmitFace} disabled={loading}>
                {loading ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Capturar y marcar</Text>}
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { flexGrow: 1, alignItems: 'center', padding: 24, gap: 10 },
  backLink: { alignSelf: 'flex-start' },
  backLinkText: { color: '#0f172a', fontWeight: '600', fontSize: 15 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  input: { width: '100%', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, fontSize: 14 },
  divider: { height: 1, width: '100%', backgroundColor: '#e2e8f0', marginVertical: 8 },
  modeSwitch: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 8, padding: 4, marginTop: 4 },
  modeButton: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 6 },
  modeButtonActive: { backgroundColor: '#0f172a' },
  modeButtonText: { fontWeight: '600', color: '#475569' },
  modeButtonTextActive: { color: 'white' },
  pinDisplay: { fontSize: 28, letterSpacing: 8, marginVertical: 8 },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', width: 240, justifyContent: 'center' },
  key: { width: 72, height: 56, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 22, fontWeight: '600' },
  cameraBox: { width: 260, height: 260, borderRadius: 130, overflow: 'hidden', backgroundColor: '#000' },
  cameraBoxSmall: { width: 90, height: 90, borderRadius: 45, overflow: 'hidden', backgroundColor: '#000' },
  camera: { width: '100%', height: '100%' },
  photoHint: { backgroundColor: '#f1f5f9', borderRadius: 8, padding: 8 },
  photoHintText: { color: '#475569', fontSize: 12, textAlign: 'center' },
  error: { color: '#b91c1c', textAlign: 'center' },
  success: { color: '#047857', textAlign: 'center' },
  submit: { marginTop: 12, backgroundColor: '#0f172a', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8 },
  submitText: { color: 'white', fontWeight: '700', fontSize: 16 },
});
