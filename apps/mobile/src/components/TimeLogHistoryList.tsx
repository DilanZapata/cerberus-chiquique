import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Modal, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getTimeLogHistory, photoUrl, TimeLogHistoryEntry } from '../services/api';

const LOG_TYPE_LABELS: Record<string, string> = {
  CHECK_IN: 'Entrada',
  LUNCH_OUT: 'Salida almuerzo',
  LUNCH_IN: 'Reingreso almuerzo',
  CHECK_OUT: 'Salida',
};

const SOURCE_LABELS: Record<string, string> = {
  KIOSK: 'Kiosco',
  MOBILE_GPS: 'App movil (GPS)',
  WEB: 'Web',
  MANUAL: 'Carga manual',
};

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Lista de marcas con coordenadas y foto de evidencia, reusada tanto para
 * "Mi historial" (empleado viendo el suyo) como para el historial de un
 * empleado especifico visto por un admin (pasando `userId`).
 */
export default function TimeLogHistoryList({ userId }: { userId?: string }) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<TimeLogHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    getTimeLogHistory(session.accessToken, daysAgoISO(30), todayISO(), userId)
      .then(setRows)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [session, userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={styles.container}>
      <Text style={styles.subtitle}>Ultimos 30 dias</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>No hay marcas en este rango.</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          contentContainerStyle={[styles.list, { paddingBottom: 16 + insets.bottom }]}
          renderItem={({ item }) => (
            <View style={styles.row}>
              {item.photoUrl ? (
                <TouchableOpacity onPress={() => setPreviewPhoto(item.photoUrl)}>
                  <Image source={{ uri: photoUrl(item.photoUrl) }} style={styles.thumb} />
                </TouchableOpacity>
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]} />
              )}
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>
                  {LOG_TYPE_LABELS[item.logType] ?? item.logType} · {new Date(item.loggedAt).toLocaleString('es-CO')}
                </Text>
                <Text style={styles.rowMeta}>
                  {SOURCE_LABELS[item.source] ?? item.source}
                  {item.workSite ? ` · ${item.workSite}` : ''}
                </Text>
                {item.latitude !== null && item.longitude !== null && (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(`https://www.google.com/maps?q=${item.latitude},${item.longitude}`)}
                  >
                    <Text style={styles.rowLink}>
                      📍 Ver ubicación
                      {item.gpsValid === false ? ' (fuera de rango)' : ''}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setPreviewPhoto(null)}>
          {previewPhoto && <Image source={{ uri: photoUrl(previewPhoto) }} style={styles.modalImage} resizeMode="contain" />}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  subtitle: { fontSize: 12, color: '#64748b', paddingHorizontal: 16, paddingTop: 12 },
  error: { color: '#b91c1c', textAlign: 'center', marginTop: 12 },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 24 },
  list: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', gap: 12, backgroundColor: 'white', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#e2e8f0' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, justifyContent: 'center', gap: 2 },
  rowTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  rowMeta: { fontSize: 12, color: '#64748b' },
  rowLink: { fontSize: 12, color: '#2563eb', marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' },
  modalImage: { width: '90%', height: '70%' },
});
