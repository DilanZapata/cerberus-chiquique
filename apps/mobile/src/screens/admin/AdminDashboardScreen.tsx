import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { AttendanceRow, getAttendance } from '../../services/api';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type Props = NativeStackScreenProps<RootStackParamList, 'AdminDashboard'>;

export default function AdminDashboardScreen({ navigation }: Props) {
  const { session, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    getAttendance(session.accessToken, todayISO())
      .then(setRows)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const checkedIn = rows.filter((r) => r.marks.checkIn).length;
  const withNovelties = rows.filter((r) => r.novelties.length > 0).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hola, {session?.user.fullName}</Text>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logoutText}>Cerrar sesion</Text>
        </TouchableOpacity>
      </View>

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
        <Text style={styles.navButtonText}>Gestionar empleados</Text>
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
          contentContainerStyle={[styles.list, { paddingBottom: 24 + insets.bottom }]}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowName}>{item.user.fullName}</Text>
              <Text style={styles.rowMeta}>
                {item.marks.checkIn ? new Date(item.marks.checkIn).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—'}
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
  container: { flex: 1, backgroundColor: '#f8fafc', paddingTop: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  greeting: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  logoutText: { color: '#94a3b8', fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: 'white', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  statValue: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 2, textAlign: 'center' },
  navButton: { marginHorizontal: 16, backgroundColor: '#0f172a', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginBottom: 16 },
  navButtonText: { color: 'white', fontWeight: '700' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#475569', paddingHorizontal: 16, marginBottom: 6 },
  error: { color: '#b91c1c', textAlign: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  rowName: { fontSize: 13, color: '#0f172a', fontWeight: '600' },
  rowMeta: { fontSize: 12, color: '#64748b' },
});
