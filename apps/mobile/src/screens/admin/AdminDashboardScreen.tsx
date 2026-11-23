import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { AttendanceRow, getAttendance, getOvertimePermissions, getPendingOvertime } from '../../services/api';
import { localDateISO } from '../../utils/dates';

const ROLE_LABELS: Record<string, string> = { ADMIN: 'Administrador', HR: 'Recursos Humanos', SUPERVISOR: 'Supervisor' };

type Props = NativeStackScreenProps<RootStackParamList, 'AdminDashboard'>;

/** Inicio de Cerberus Managers: asistencia de hoy y accesos segun lo que el rol puede hacer. */
export default function AdminDashboardScreen({ navigation }: Props) {
  const { session, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** null = aun no se sabe si este rol puede autorizar horas extra. */
  const [canApprove, setCanApprove] = useState<boolean | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const load = useCallback(() => {
    if (!session) return;
    const token = session.accessToken;
    setLoading(true);
    setError(null);
    getAttendance(token, localDateISO())
      .then(setRows)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // Que roles autorizan horas extra lo define cada empresa (y puede cambiarlo
    // cuando quiera), por eso se consulta al entrar y no se asume por el rol.
    getOvertimePermissions(token)
      .then(async (permissions) => {
        setCanApprove(permissions.canApprove);
        setPendingCount(permissions.canApprove ? (await getPendingOvertime(token)).length : 0);
      })
      .catch(() => setCanApprove(false));
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const checkedIn = rows.filter((r) => r.marks.checkIn).length;
  const withNovelties = rows.filter((r) => r.novelties.length > 0).length;
  const role = session?.user.role ?? '';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting} numberOfLines={1}>
            Hola, {session?.user.fullName}
          </Text>
          <Text style={styles.role}>{ROLE_LABELS[role] ?? role}</Text>
        </View>
        <TouchableOpacity onPress={logout} hitSlop={10}>
          <Text style={styles.logoutText}>Cerrar sesion</Text>
        </TouchableOpacity>
      </View>

      {canApprove && (
        <View style={styles.overtimeCard}>
          <View style={styles.overtimeHeader}>
            <Text style={styles.overtimeTitle}>Horas extra</Text>
            <View style={[styles.pendingPill, pendingCount === 0 && styles.pendingPillClear]}>
              <Text style={[styles.pendingPillText, pendingCount === 0 && styles.pendingPillTextClear]}>
                {pendingCount === 0 ? 'Al dia' : `${pendingCount} por decidir`}
              </Text>
            </View>
          </View>
          <View style={styles.overtimeActions}>
            <TouchableOpacity style={[styles.overtimeButton, styles.primaryButton]} onPress={() => navigation.navigate('AdminOvertimeAuthorize')}>
              <Text style={styles.primaryButtonText}>Autorizar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.overtimeButton, styles.outlineButton]} onPress={() => navigation.navigate('AdminOvertime')}>
              <Text style={styles.outlineButtonText}>Ver pendientes</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {canApprove === false && (
        <Text style={styles.notice}>
          Tu rol no esta habilitado para autorizar horas extra. Un administrador puede habilitarlo en el panel web
          (Parametros de Nomina).
        </Text>
      )}

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{rows.length}</Text>
          <Text style={styles.statLabel}>Empleados</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{checkedIn}</Text>
          <Text style={styles.statLabel}>Con entrada hoy</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{withNovelties}</Text>
          <Text style={styles.statLabel}>Con novedades</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.navButton} onPress={() => navigation.navigate('AdminEmployeesList')}>
        <Text style={styles.navButtonText}>Gestionar empleados y rostros</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Asistencia de hoy</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.user.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          contentContainerStyle={[styles.list, { paddingBottom: 96 + insets.bottom }]}
          ListEmptyComponent={<Text style={styles.empty}>Sin empleados para mostrar.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowName} numberOfLines={1}>
                {item.user.fullName}
              </Text>
              <Text style={styles.rowMeta}>
                {item.marks.checkIn ? new Date(item.marks.checkIn).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : 'Sin entrada'}
                {item.novelties.length > 0 ? ` · ${item.novelties.length} novedad(es)` : ''}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', paddingTop: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 12 },
  greeting: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  role: { fontSize: 12, color: '#64748b', marginTop: 1 },
  logoutText: { color: '#64748b', fontSize: 13 },
  overtimeCard: { marginHorizontal: 16, marginBottom: 12, backgroundColor: 'white', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', gap: 12 },
  overtimeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  overtimeTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  pendingPill: { backgroundColor: '#fef3c7', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  pendingPillClear: { backgroundColor: '#d1fae5' },
  pendingPillText: { color: '#92400e', fontSize: 12, fontWeight: '700' },
  pendingPillTextClear: { color: '#065f46' },
  overtimeActions: { flexDirection: 'row', gap: 10 },
  overtimeButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  primaryButton: { backgroundColor: '#059669' },
  primaryButtonText: { color: 'white', fontWeight: '700' },
  outlineButton: { borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: 'white' },
  outlineButtonText: { color: '#0f172a', fontWeight: '700' },
  notice: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 10, backgroundColor: '#f1f5f9', color: '#475569', fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: 'white', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  statValue: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 2, textAlign: 'center' },
  navButton: { marginHorizontal: 16, backgroundColor: '#0f172a', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginBottom: 16 },
  navButtonText: { color: 'white', fontWeight: '700' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#475569', paddingHorizontal: 16, marginBottom: 6 },
  error: { color: '#b91c1c', textAlign: 'center', paddingHorizontal: 16 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 24, fontSize: 13 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  rowName: { flex: 1, fontSize: 13, color: '#0f172a', fontWeight: '600' },
  rowMeta: { fontSize: 12, color: '#64748b' },
});
