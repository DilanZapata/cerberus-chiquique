import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { enrollFace } from '../../services/api';

const CONSENT_TEXT =
  'Autorizo expresamente a la empresa a procesar mi imagen facial (dato biometrico, dato sensible segun la Ley 1581 de 2012) ' +
  'con la unica finalidad de registrar mi entrada y salida laboral en el sistema Cerberus. Entiendo que esta informacion se ' +
  'procesa y almacena en los servidores propios de la empresa, nunca se comparte con servicios de terceros, y que puedo ' +
  'solicitar la eliminacion de mi registro biometrico en cualquier momento.';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminFaceEnroll'>;

/** Enrolamiento de rostro con consentimiento explicito (Ley 1581 de 2012), igual que en la web. */
export default function FaceEnrollScreen({ route, navigation }: Props) {
  const { employeeId, employeeName } = route.params;
  const { session } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  async function handleCapture() {
    if (!session || !cameraRef.current) return;
    setSubmitting(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.8 });
      if (!photo?.base64) throw new Error('No se pudo capturar la foto.');
      await enrollFace(session.accessToken, {
        userId: employeeId,
        imageBase64: `data:image/jpeg;base64,${photo.base64}`,
        consentText: CONSENT_TEXT,
      });
      navigation.goBack();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Enrolar rostro — {employeeName}</Text>

      {!accepted ? (
        <>
          <Text style={styles.consentText}>{CONSENT_TEXT}</Text>
          <TouchableOpacity style={styles.checkboxRow} onPress={() => setAccepted(true)}>
            <View style={styles.checkbox} />
            <Text style={styles.checkboxLabel}>El empleado leyo y acepta expresamente este tratamiento de su dato biometrico.</Text>
          </TouchableOpacity>
        </>
      ) : !permission?.granted ? (
        <TouchableOpacity style={styles.submit} onPress={requestPermission}>
          <Text style={styles.submitText}>Permitir uso de la camara</Text>
        </TouchableOpacity>
      ) : (
        <>
          <View style={styles.cameraBox}>
            <CameraView ref={cameraRef} style={styles.camera} facing="front" />
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.submit} onPress={handleCapture} disabled={submitting}>
            {submitting ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>Capturar y enrolar</Text>}
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity style={styles.cancel} onPress={() => navigation.goBack()}>
        <Text style={styles.cancelText}>Cancelar</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', padding: 24, gap: 14 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  consentText: { fontSize: 13, color: '#475569', lineHeight: 19 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  checkbox: { width: 20, height: 20, borderWidth: 2, borderColor: '#0f172a', borderRadius: 4 },
  checkboxLabel: { flex: 1, fontSize: 13, color: '#0f172a' },
  cameraBox: { width: 240, height: 240, borderRadius: 120, overflow: 'hidden', backgroundColor: '#000' },
  camera: { width: '100%', height: '100%' },
  error: { color: '#b91c1c', textAlign: 'center' },
  submit: { backgroundColor: '#0f172a', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8 },
  submitText: { color: 'white', fontWeight: '700', fontSize: 16 },
  cancel: { padding: 8 },
  cancelText: { color: '#94a3b8', fontSize: 13 },
});
