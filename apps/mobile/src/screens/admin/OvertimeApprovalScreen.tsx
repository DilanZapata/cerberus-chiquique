import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import {
  getOvertimeAuthorizations,
  getPendingOvertime,
  OvertimeAuthorization,
  PendingOvertime,
  reviewOvertime,
} from '../../services/api';
import { addDaysISO, formatDateLong, hoursLabel, localDateISO } from '../../utils/dates';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminOvertime'>;
type Tab = 'pending' | 'authorized';

/**
 * Horas extra en Cerberus Managers:
 *  - Pendientes: horas trabajadas sin autorizacion (o por encima de lo
 *    autorizado). Se aprueban todas, solo una parte, o se rechazan.
 *  - Autorizadas: lo que se autorizo por persona y dia, contra lo que de
 *    verdad se trabajo (se paga lo menor de los dos).
 */
export default function OvertimeApprovalScreen({ navigation }: Props) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<PendingOvertime[]>([]);
  const [authorized, setAuthorized] = useState<OvertimeAuthorization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Horas a aprobar elegidas por solicitud (por defecto, todo lo pendiente). */
  const [chosenHours, setChosenHours] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const today = localDateISO();
      const [pendingRows, authorizedRows] = await Promise.all([
        getPendingOvertime(session.accessToken),
        // Ultimos 30 dias y proximos 30: las autorizaciones pueden darse por adelantado.
        getOvertimeAuthorizations(session.accessToken, addDaysISO(today, -30), addDaysISO(today, 30)),
      ]);
      setPending(pendingRows);
      setAuthorized(authorizedRows);
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

  async function decide(item: PendingOvertime, status: 'APROBADA' | 'RECHAZADA') {
    if (!session) return;
    const pendingHours = Number(item.requestedHours);
    const hours = chosenHours[item.id] ?? pendingHours;
    setBusyId(item.id);
    setError(null);
    try {
      await reviewOvertime(
        session.accessToken,
        item.id,
        status === 'APROBADA' && hours < pendingHours ? { status, approvedHours: hours } : { status },
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function confirmReject(item: PendingOvertime) {
    Alert.alert(
      'Rechazar horas extra',
      `Las ${hoursLabel(Number(item.requestedHours))} pendientes de ${item.novelty.user.fullName} no se pagaran. Quedan registradas como rechazadas.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Rechazar', style: 'destructive', onPress: () => decide(item, 'RECHAZADA') },
      ],
    );
  }

  function step(item: PendingOvertime, delta: number) {
    const max = Number(item.requestedHours);
    setChosenHours((prev) => {
      const next = Math.min(max, Math.max(0.5, (prev[item.id] ?? max) + delta));
      return { ...prev, [item.id]: next };
    });
  }

  const listPadding = { paddingBottom: 24 + insets.bottom };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.authorizeButton} onPress={() => navigation.navigate('AdminOvertimeAuthorize')}>
        <Text style={styles.authorizeButtonText}>Autorizar horas extra a una persona</Text>
      </TouchableOpacity>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'pending' && styles.tabActive]} onPress={() => setTab('pending')}>
          <Text style={[styles.tabText, tab === 'pending' && styles.tabTextActive]}>
            Pendientes{pending.length > 0 ? ` (${pending.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'authorized' && styles.tabActive]} onPress={() => setTab('authorized')}>
          <Text style={[styles.tabText, tab === 'authorized' && styles.tabTextActive]}>Autorizadas</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {tab === 'pending' ? (
        <FlatList
          data={pending}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          contentContainerStyle={[styles.list, listPadding]}
          ListEmptyComponent={
            loading ? <ActivityIndicator style={{ marginTop: 24 }} /> : <Text style={styles.empty}>No hay horas extra pendientes por decidir.</Text>
          }
          renderItem={({ item }) => {
            const pendingHours = Number(item.requestedHours);
            const hours = chosenHours[item.id] ?? pendingHours;
            const busy = busyId === item.id;
            return (
              <View style={styles.card}>
                <Text style={styles.name}>{item.novelty.user.fullName}</Text>
                <Text style={styles.meta}>
                  {item.novelty.user.employeeCode} · {formatDateLong(item.novelty.workDate)}
                </Text>

                <View style={styles.figures}>
                  <View style={styles.figure}>
                    <Text style={styles.figureValue}>{item.workedHours}</Text>
                    <Text style={styles.figureLabel}>trabajadas</Text>
                  </View>
                  <View style={styles.figure}>
                    <Text style={styles.figureValue}>{item.authorizedHours}</Text>
                    <Text style={styles.figureLabel}>autorizadas</Text>
                  </View>
                  <View style={styles.figure}>
                    <Text style={[styles.figureValue, styles.figurePending]}>{pendingHours}</Text>
                    <Text style={styles.figureLabel}>pendientes</Text>
                  </View>
                </View>
                <Text style={styles.context}>
                  {item.authorizedHours > 0
                    ? `Se autorizaron ${hoursLabel(item.authorizedHours)}${item.authorizedByName ? ` (${item.authorizedByName})` : ''} y trabajo mas.`
                    : 'Trabajo horas extra sin autorizacion previa.'}
                </Text>

                <View style={styles.stepperRow}>
                  <Text style={styles.stepperLabel}>Aprobar</Text>
                  <TouchableOpacity style={styles.stepperButton} disabled={busy || hours <= 0.5} onPress={() => step(item, -0.5)}>
                    <Text style={styles.stepperButtonText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>{hours} h</Text>
                  <TouchableOpacity style={styles.stepperButton} disabled={busy || hours >= pendingHours} onPress={() => step(item, 0.5)}>
                    <Text style={styles.stepperButtonText}>+</Text>
                  </TouchableOpacity>
                  {hours < pendingHours && <Text style={styles.stepperHint}>quedan {pendingHours - hours} pendientes</Text>}
                </View>

                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.actionButton, styles.dangerButton]} disabled={busy} onPress={() => confirmReject(item)}>
                    <Text style={styles.dangerText}>Rechazar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionButton, styles.successButton]} disabled={busy} onPress={() => decide(item, 'APROBADA')}>
                    {busy ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.successText}>Aprobar {hours} h</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          data={authorized}
          keyExtractor={(item) => `${item.userId}-${item.workDate}`}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          contentContainerStyle={[styles.list, listPadding]}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 24 }} />
            ) : (
              <Text style={styles.empty}>Aun no hay autorizaciones (ultimos 30 dias y proximos 30).</Text>
            )
          }
          renderItem={({ item }) => {
            const state =
              item.pendingHours > 0
                ? { text: `${item.pendingHours} h pendientes`, style: styles.stateWarning, textStyle: styles.stateWarningText }
                : item.rejectedHours > 0
                  ? { text: `${item.rejectedHours} h rechazadas`, style: styles.stateDanger, textStyle: styles.stateDangerText }
                  : item.workedHours === 0
                    ? { text: 'Sin trabajar aun', style: styles.stateNeutral, textStyle: styles.stateNeutralText }
                    : { text: 'Al dia', style: styles.stateGood, textStyle: styles.stateGoodText };
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
                    {item.fullName}
                  </Text>
                  <View style={[styles.state, state.style]}>
                    <Text style={[styles.stateText, state.textStyle]}>{state.text}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {item.employeeCode} · {formatDateLong(item.workDate)}
                </Text>
                <View style={styles.figures}>
                  <View style={styles.figure}>
                    <Text style={styles.figureValue}>{item.authorizedHours}</Text>
                    <Text style={styles.figureLabel}>autorizadas</Text>
                  </View>
                  <View style={styles.figure}>
                    <Text style={styles.figureValue}>{item.workedHours}</Text>
                    <Text style={styles.figureLabel}>trabajadas</Text>
                  </View>
                  <View style={styles.figure}>
                    <Text style={[styles.figureValue, styles.figurePaid]}>{item.approvedHours}</Text>
                    <Text style={styles.figureLabel}>se pagan</Text>
                  </View>
                </View>
                {(item.authorizedByName || item.notes) && (
                  <Text style={styles.context}>
                    {item.authorizedByName ? `Autorizo: ${item.authorizedByName}` : ''}
                    {item.authorizedByName && item.notes ? ' · ' : ''}
                    {item.notes ?? ''}
                  </Text>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  authorizeButton: { margin: 16, marginBottom: 12, backgroundColor: '#059669', paddingVertical: 13, borderRadius: 8, alignItems: 'center' },
  authorizeButtonText: { color: 'white', fontWeight: '700', fontSize: 14 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: '#e2e8f0', borderRadius: 8, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  tabActive: { backgroundColor: 'white' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#0f172a' },
  error: { color: '#b91c1c', textAlign: 'center', marginTop: 12, paddingHorizontal: 16 },
  empty: { color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  list: { padding: 16, gap: 10 },
  card: { backgroundColor: 'white', borderRadius: 10, padding: 14, gap: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  meta: { fontSize: 12, color: '#64748b' },
  figures: { flexDirection: 'row', marginTop: 10, backgroundColor: '#f8fafc', borderRadius: 8, paddingVertical: 8 },
  figure: { flex: 1, alignItems: 'center' },
  figureValue: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  figurePending: { color: '#b45309' },
  figurePaid: { color: '#047857' },
  figureLabel: { fontSize: 11, color: '#64748b' },
  context: { fontSize: 12, color: '#475569', marginTop: 8 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  stepperLabel: { fontSize: 13, color: '#334155', fontWeight: '600' },
  stepperButton: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white' },
  stepperButtonText: { fontSize: 20, color: '#0f172a', fontWeight: '700' },
  stepperValue: { minWidth: 52, textAlign: 'center', fontSize: 16, fontWeight: '800', color: '#0f172a' },
  stepperHint: { flex: 1, fontSize: 11, color: '#b45309' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionButton: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  dangerButton: { borderWidth: 1, borderColor: '#fecaca', backgroundColor: 'white' },
  dangerText: { color: '#b91c1c', fontWeight: '700', fontSize: 13 },
  successButton: { backgroundColor: '#059669' },
  successText: { color: 'white', fontWeight: '700', fontSize: 13 },
  state: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999 },
  stateText: { fontSize: 11, fontWeight: '700' },
  stateWarning: { backgroundColor: '#fef3c7' },
  stateWarningText: { color: '#92400e' },
  stateDanger: { backgroundColor: '#fee2e2' },
  stateDangerText: { color: '#991b1b' },
  stateNeutral: { backgroundColor: '#f1f5f9' },
  stateNeutralText: { color: '#475569' },
  stateGood: { backgroundColor: '#d1fae5' },
  stateGoodText: { color: '#065f46' },
});
