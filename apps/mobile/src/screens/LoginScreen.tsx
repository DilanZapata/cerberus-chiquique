import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../context/AuthContext';

/**
 * Login unico para toda la app: el rol que devuelve el backend decide que
 * pantallas ve la persona despues (RootNavigator cambia el stack segun rol).
 */
export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      // La navegacion cambia sola: RootNavigator reacciona al cambio de sesion.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>Iniciar sesion</Text>
      <Text style={styles.subtitle}>Empleados, administradores, RRHH y supervisores usan el mismo ingreso.</Text>
      <TextInput
        style={styles.input}
        placeholder="Correo"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput style={styles.input} placeholder="Contrasena" value={password} onChangeText={setPassword} secureTextEntry />
      {error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading || !email || !password}>
        {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Ingresar</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 13, color: '#475569', textAlign: 'center', marginBottom: 8 },
  input: { width: '100%', maxWidth: 320, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, fontSize: 14 },
  error: { color: '#b91c1c', textAlign: 'center' },
  button: { backgroundColor: '#0f172a', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8, marginTop: 8 },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 16 },
});
