import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { deactivateEmployee, Employee, getEmployees, getFaceStatus } from '../../services/api';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  HR: 'Recursos Humanos',
  SUPERVISOR: 'Supervisor',
  EMPLOYEE: 'Empleado',
};

type Props = NativeStackScreenProps<RootStackParamList, 'AdminEmployeesList'>;

export default function EmployeesListScreen({ navigation }: Props) {
  const { session, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [faceEnrolled, setFaceEnrolled] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Busqueda sin tildes ni mayusculas, por nombre, cedula, codigo o correo.
  const visible = useMemo(() => {
    const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    // Cada palabra se busca por separado: "beatriz tardia" encuentra a "Beatriz Llegada Tardia".
    const words = normalize(search.trim()).split(/\s+/).filter(Boolean);
    if (words.length === 0) return employees;
    return employees.filter((e) => {
      const haystack = normalize(`${e.fullName} ${e.nationalId ?? ''} ${e.employeeCode} ${e.email ?? ''}`);
      return words.every((word) => haystack.includes(word));
    });
  }, [employees, search]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const list = await getEmployees(session.accessToken);
      setEmployees(list);
      const statuses = await Promise.all(list.map((e) => getFaceStatus(session.accessToken, e.id).catch(() => ({ enrolled: false }))));
      setFaceEnrolled(Object.fromEntries(list.map((e, i) => [e.id, statuses[i].enrolled])));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleDeactivate(id: string) {
    if (!session) return;
    await deactivateEmployee(session.accessToken, id);
    load();
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.newButton} onPress={() => navigation.navigate('AdminEmployeeForm', undefined)}>
          <Text style={styles.newButtonText}>+ Nuevo empleado</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logoutText}>Cerrar sesion</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Buscar por nombre, cedula o codigo"
        placeholderTextColor="#94a3b8"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {search.trim() !== '' && (
        <Text style={styles.searchCount}>
          {visible.length} de {employees.length} empleado(s)
        </Text>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {loading && employees.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={visible}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={styles.empty}>{employees.length === 0 ? 'Todavia no hay empleados.' : `Ningun empleado coincide con "${search}".`}</Text>}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          contentContainerStyle={[styles.list, { paddingBottom: 24 + insets.bottom }]}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.name}>{item.fullName}</Text>
                <View style={[styles.badge, item.isActive ? styles.badgeGood : styles.badgeNeutral]}>
                  <Text style={styles.badgeText}>{item.isActive ? 'Activo' : 'Inactivo'}</Text>
                </View>
              </View>
              <Text style={styles.meta}>
                CC {item.nationalId} · {item.employeeCode} · {ROLE_LABELS[item.role] ?? item.role}
              </Text>
              <Text style={styles.meta}>
                {item.department?.name ?? 'Sin depto.'} · {item.workSites.map((s) => s.name).join(', ') || 'Sin sede'}
              </Text>
              <View style={styles.badgeRow}>
                <View style={[styles.badge, faceEnrolled[item.id] ? styles.badgeGood : styles.badgeNeutral]}>
                  <Text style={styles.badgeText}>{faceEnrolled[item.id] ? 'Rostro enrolado' : 'Sin enrolar'}</Text>
                </View>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('AdminEmployeeForm', { employeeId: item.id })}>
                  <Text style={styles.actionText}>Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => navigation.navigate('AdminEmployeeHistory', { employeeId: item.id, employeeName: item.fullName })}
                >
                  <Text style={styles.actionText}>Ver historial</Text>
                </TouchableOpacity>
                {!faceEnrolled[item.id] && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => navigation.navigate('AdminFaceEnroll', { employeeId: item.id, employeeName: item.fullName })}
                  >
                    <Text style={styles.actionText}>Enrolar rostro</Text>
                  </TouchableOpacity>
                )}
                {item.isActive && (
                  <TouchableOpacity style={[styles.actionButton, styles.dangerButton]} onPress={() => handleDeactivate(item.id)}>
                    <Text style={[styles.actionText, styles.dangerText]}>Desactivar</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  newButton: { backgroundColor: '#0f172a', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  newButtonText: { color: 'white', fontWeight: '600', fontSize: 13 },
  logoutText: { color: '#94a3b8', fontSize: 13 },
  error: { color: '#b91c1c', textAlign: 'center', marginBottom: 8 },
  search: { marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#0f172a', backgroundColor: 'white' },
  searchCount: { marginHorizontal: 16, marginBottom: 6, fontSize: 12, color: '#64748b' },
  empty: { textAlign: 'center', color: '#64748b', marginTop: 24 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: { backgroundColor: 'white', borderRadius: 10, padding: 14, gap: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  meta: { fontSize: 12, color: '#64748b' },
  badgeRow: { flexDirection: 'row', marginTop: 4 },
  badge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 12 },
  badgeGood: { backgroundColor: '#d1fae5' },
  badgeNeutral: { backgroundColor: '#e2e8f0' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#0f172a' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  actionButton: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  actionText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  dangerButton: { borderColor: '#fecaca' },
  dangerText: { color: '#b91c1c' },
});
