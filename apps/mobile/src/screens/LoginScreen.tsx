import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { APP_NAME, IS_MANAGERS } from '../config/variant';

/**
 * Login de la app. En Cerberus Staff lleva al marcaje personal; en Cerberus
 * Managers solo deja entrar a administradores, RRHH y supervisores (lo
 * valida AuthContext con el rol que devuelve el backend).
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
      await login(email.trim(), password);
      // La navegacion cambia sola: RootNavigator reacciona al cambio de sesion.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{APP_NAME}</Text>
      </View>
      <Text style={styles.title}>Iniciar sesion</Text>
      <Text style={styles.subtitle}>
        {IS_MANAGERS
          ? 'Para administradores, RRHH y supervisores: autoriza horas extra y gestiona al personal.'
          : 'Ingresa con tu correo para marcar tu asistencia y ver tu historial.'}
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Correo"
        placeholderTextColor="#94a3b8"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Contrasena"
        placeholderTextColor="#94a3b8"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity
        style={[styles.button, (loading || !email || !password) && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={loading || !email || !password}
      >
        {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Ingresar</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Colores fijos (fondo claro, texto oscuro): con el telefono en modo oscuro
  // el texto escrito no puede quedar invisible.
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#f8fafc' },
  badge: { backgroundColor: IS_MANAGERS ? '#059669' : '#0f172a', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, marginBottom: 4 },
  badgeText: { color: 'white', fontWeight: '700', fontSize: 13 },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#475569', textAlign: 'center', marginBottom: 8, maxWidth: 320 },
  input: {
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#0f172a',
    backgroundColor: 'white',
  },
  error: { color: '#b91c1c', textAlign: 'center', maxWidth: 320 },
  button: { backgroundColor: '#0f172a', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8, marginTop: 8, minWidth: 180, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 16 },
});
