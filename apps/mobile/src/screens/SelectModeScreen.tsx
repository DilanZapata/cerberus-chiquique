import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SelectMode'>;

/** Punto de entrada: terminal compartida (kiosco) o inicio de sesion personal (empleado, admin, RRHH, supervisor). */
export default function SelectModeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Cerberus</Text>
      <Text style={styles.subtitle}>Selecciona como quieres usar esta terminal</Text>
      <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Kiosk')}>
        <Text style={styles.buttonText}>Modo Kiosco</Text>
        <Text style={styles.buttonHint}>Terminal fija: marca por codigo+PIN o reconocimiento facial</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Login')}>
        <Text style={styles.buttonText}>Iniciar sesion</Text>
        <Text style={styles.buttonHint}>Empleados: marca tu asistencia. Admin/RRHH/Supervisor: panel completo.</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 14, color: '#475569', textAlign: 'center', marginBottom: 8 },
  button: { backgroundColor: '#0f172a', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 10, width: '100%', maxWidth: 320 },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  buttonHint: { color: '#cbd5e1', fontSize: 12, textAlign: 'center', marginTop: 4 },
});
