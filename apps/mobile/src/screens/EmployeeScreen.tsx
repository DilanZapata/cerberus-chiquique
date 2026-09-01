import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { ApiError, mobileClock } from '../services/api';
import { authenticateWithBiometrics, isBiometricAvailable } from '../services/biometrics';

/** "3 min 12 s" / "45 s" -- para el contador del boton y el mensaje de espera. */
function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

const LOG_TYPE_LABELS: Record<string, string> = {
  CHECK_IN: 'Entrada registrada',
  LUNCH_OUT: 'Salida a almuerzo registrada',
  LUNCH_IN: 'Reingreso de almuerzo registrado',
  CHECK_OUT: 'Salida registrada',
};

type Props = NativeStackScreenProps<RootStackParamList, 'EmployeeClock'>;

/** Modo Empleado: marcaje personal desde el telefono, validado por GPS contra la sede asignada, con foto de evidencia. */
export default function EmployeeScreen({ navigation }: Props) {
  const { session, logout } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  // Cuenta regresiva local (solo mejora visual: deshabilita el boton y
  // muestra cuanto falta). La seguridad real la garantiza el backend --
  // si el reloj del telefono esta desfasado o la app se cerro y reabrio
  // antes de que terminara la espera, el backend igual rechaza el
  // intento y este contador se resincroniza con el `secondsRemaining`
  // que devuelve el error.
  const [cooldownSecondsLeft, setCooldownSecondsLeft] = useState(0);
  const cooldownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown(seconds: number) {
    if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    setCooldownSecondsLeft(seconds);
    cooldownInterval.current = setInterval(() => {
      setCooldownSecondsLeft((prev) => {
        if (prev <= 1) {
          if (cooldownInterval.current) clearInterval(cooldownInterval.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    isBiometricAvailable().then(setBiometricAvailable);
    return () => {
      if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    };
  }, []);

  async function handleClock() {
    if (!session || cooldownSecondsLeft > 0) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      // Face ID/huella: solo confirma que el dueño de ESTE telefono esta
      // presente, no identifica a nadie (por eso no aplica en el kiosco
      // compartido). Si el telefono no tiene el sensor o nadie lo enrolo,
      // se omite sin bloquear el marcaje.
      if (biometricAvailable) {
        const confirmed = await authenticateWithBiometrics('Confirma tu identidad para marcar asistencia');
        if (!confirmed) {
          throw new Error('No se pudo confirmar tu identidad con Face ID/huella.');
        }
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Se necesita permiso de ubicacion para marcar.');
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });

      let imageBase64: string | undefined;
      if (permission?.granted && cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
        if (photo?.base64) imageBase64 = `data:image/jpeg;base64,${photo.base64}`;
      }

      const result = await mobileClock(session.accessToken, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        imageBase64,
      });
      setMessage(`${LOG_TYPE_LABELS[result.logType]} (${result.distanceMeters}m de la sede).`);
      // El backend es quien realmente impide un nuevo registro antes de 5
      // minutos (DUPLICATE_REGISTRATION_WINDOW_MIN); este contador es solo
      // para que el boton no invite a tocarlo de nuevo mientras tanto.
      startCooldown(5 * 60);
    } catch (err) {
      setError((err as Error).message);
      // Si el backend rechazo por el guard de duplicados, viene con
      // secondsRemaining -- resincroniza el contador local con el real en
      // vez de dejarlo en 0 (ej. la app se cerro y reabrio a mitad de la
      // espera, o dos dispositivos marcaron casi al mismo tiempo).
      const seconds = (err as ApiError).secondsRemaining;
      if (typeof seconds === 'number' && seconds > 0) startCooldown(seconds);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <Text style={styles.title}>Hola, {session?.user.fullName}</Text>
      <Text style={styles.subtitle}>Marca tu entrada o salida validando tu ubicacion y tomando una foto de respaldo.</Text>
      {biometricAvailable && (
        <Text style={styles.biometricHint}>Te pediremos Face ID/huella para confirmar que eres tu.</Text>
      )}

      {!permission?.granted ? (
        <TouchableOpacity style={styles.photoHint} onPress={requestPermission}>
          <Text style={styles.photoHintText}>Permitir camara (foto de evidencia junto a la marca)</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.cameraBox}>
          <CameraView ref={cameraRef} style={styles.camera} facing="front" />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {message && <Text style={styles.success}>{message}</Text>}
      {cooldownSecondsLeft > 0 && (
        <Text style={styles.cooldownHint}>Podras volver a marcar en {formatCountdown(cooldownSecondsLeft)}.</Text>
      )}
      <TouchableOpacity
        style={[styles.button, cooldownSecondsLeft > 0 && styles.buttonDisabled]}
        onPress={handleClock}
        disabled={loading || cooldownSecondsLeft > 0}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>{cooldownSecondsLeft > 0 ? formatCountdown(cooldownSecondsLeft) : 'Marcar ahora'}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.historyButton} onPress={() => navigation.navigate('MyHistory')}>
        <Text style={styles.historyButtonText}>Ver mi historial</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Cerrar sesion</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 14, color: '#475569', textAlign: 'center' },
  biometricHint: { fontSize: 12, color: '#0f172a', fontWeight: '600', textAlign: 'center', marginTop: 2 },
  cameraBox: { width: 160, height: 160, borderRadius: 80, overflow: 'hidden', backgroundColor: '#000', marginVertical: 8 },
  camera: { width: '100%', height: '100%' },
  photoHint: { backgroundColor: '#f1f5f9', borderRadius: 8, padding: 10, marginVertical: 8 },
  photoHintText: { color: '#475569', fontSize: 12, textAlign: 'center' },
  error: { color: '#b91c1c', textAlign: 'center' },
  success: { color: '#047857', textAlign: 'center' },
  button: { backgroundColor: '#0f172a', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8, marginTop: 8 },
  buttonDisabled: { backgroundColor: '#94a3b8' },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 16 },
  cooldownHint: { color: '#475569', fontSize: 12, textAlign: 'center' },
  historyButton: { marginTop: 10, padding: 8 },
  historyButtonText: { color: '#0f172a', fontWeight: '600', fontSize: 13, textDecorationLine: 'underline' },
  logoutButton: { marginTop: 16, padding: 8 },
  logoutText: { color: '#94a3b8', fontSize: 13 },
});
