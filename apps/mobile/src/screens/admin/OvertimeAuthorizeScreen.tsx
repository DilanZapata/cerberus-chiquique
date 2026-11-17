import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { authorizeOvertime, Employee, getEmployees, OvertimeAuthorization } from '../../services/api';
import { addDaysISO, formatDateLong, hoursLabel, localDateISO } from '../../utils/dates';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminOvertimeAuthorize'>;

const MAX_HOURS = 16;
const MAX_MATCHES = 8;

/**
 * "A esta persona, este dia, le autorizo N horas extra". Se puede dar antes
 * de que las trabaje (hoy o un dia futuro) o despues. Se paga lo menor entre
 * lo autorizado y lo trabajado; si trabaja mas, el resto queda pendiente y el
 * sistema avisa por correo a quien autorizo.
 */
export default function OvertimeAuthorizeScreen({ navigation }: Props) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [search, setSearch] = useState('');
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [workDate, setWorkDate] = useState(localDateISO());
  const [hours, setHours] = useState(1);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OvertimeAuthorization | null>(null);

  useEffect(() => {
    if (!session) return;
    getEmployees(session.accessToken)
      .then((list) => setEmployees(list.filter((e) => e.isActive).sort((a, b) => a.fullName.localeCompare(b.fullName))))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingEmployees(false));
  }, [session]);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? employees.filter(
          (e) =>
            e.fullName.toLowerCase().includes(term) ||
            e.nationalId.toLowerCase().includes(term) ||
            e.employeeCode.toLowerCase().includes(term),
        )
      : employees;
    return list.slice(0, MAX_MATCHES);
  }, [employees, search]);

  const today = localDateISO();
  const dateHint = workDate === today ? 'Hoy' : workDate === addDaysISO(today, 1) ? 'Manana' : workDate === addDaysISO(today, -1) ? 'Ayer' : null;

  async function submit() {
    if (!session || !employee) return;
    setSaving(true);
    setError(null);
    try {
      setResult(
        await authorizeOvertime(session.accessToken, {
          userId: employee.id,
          workDate,
          hours,
          notes: notes.trim() || undefined,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startAnother() {
    setResult(null);
    setEmployee(null);
    setSearch('');
    setNotes('');
    setHours(1);
  }

  if (result) {
    return (
      <View style={[styles.container, styles.resultContainer, { paddingBottom: 24 + insets.bottom }]}>
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>Autorizacion guardada</Text>
          <Text style={styles.resultText}>
            {result.fullName} tiene <Text style={styles.bold}>{hoursLabel(result.authorizedHours)} extra autorizadas</Text> para el{' '}
            {formatDateLong(result.workDate)}.
          </Text>
          {result.workedHours > 0 ? (
            <Text style={styles.resultText}>
              Ese dia trabajo {hoursLabel(result.workedHours)} extra: se pagan <Text style={styles.bold}>{result.approvedHours}</Text>
              {result.pendingHours > 0 ? ` y quedan ${result.pendingHours} pendientes por decidir.` : '.'}
            </Text>
          ) : (
            <Text style={styles.resultText}>
              Se pagara solo lo que realmente trabaje, hasta ese tope. Si trabaja mas, el resto queda pendiente y te llega un
              correo para que lo decidas.
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.submit} onPress={startAnother}>
          <Text style={styles.submitText}>Autorizar a otra persona</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Empleado</Text>
        {employee ? (
          <View style={styles.selected}>
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedName}>{employee.fullName}</Text>
              <Text style={styles.selectedMeta}>
                {employee.employeeCode} · CC {employee.nationalId}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setEmployee(null)} hitSlop={10}>
              <Text style={styles.change}>Cambiar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Buscar por nombre, cedula o codigo"
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
            {loadingEmployees ? (
              <ActivityIndicator style={{ marginTop: 12 }} />
            ) : matches.length === 0 ? (
              <Text style={styles.noMatches}>Ningun empleado activo coincide.</Text>
            ) : (
              <View style={styles.matches}>
                {matches.map((item, index) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.match, index > 0 && styles.matchBorder]}
                    onPress={() => setEmployee(item)}
                  >
                    <Text style={styles.matchName}>{item.fullName}</Text>
                    <Text style={styles.matchMeta}>
                      {item.employeeCode} · CC {item.nationalId}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        <Text style={styles.label}>Dia</Text>
        <View style={styles.stepper}>
          <TouchableOpacity style={styles.stepperButton} onPress={() => setWorkDate(addDaysISO(workDate, -1))}>
            <Text style={styles.stepperButtonText}>‹</Text>
          </TouchableOpacity>
          <View style={styles.stepperCenter}>
            <Text style={styles.stepperValue}>{formatDateLong(workDate)}</Text>
            {dateHint && <Text style={styles.stepperHint}>{dateHint}</Text>}
          </View>
          <TouchableOpacity style={styles.stepperButton} onPress={() => setWorkDate(addDaysISO(workDate, 1))}>
            <Text style={styles.stepperButtonText}>›</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.quickRow}>
          <TouchableOpacity style={styles.quick} onPress={() => setWorkDate(addDaysISO(today, -1))}>
            <Text style={styles.quickText}>Ayer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quick} onPress={() => setWorkDate(today)}>
            <Text style={styles.quickText}>Hoy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quick} onPress={() => setWorkDate(addDaysISO(today, 1))}>
            <Text style={styles.quickText}>Manana</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Horas extra autorizadas</Text>
        <View style={styles.stepper}>
          <TouchableOpacity style={styles.stepperButton} disabled={hours <= 0.5} onPress={() => setHours(Math.max(0.5, hours - 0.5))}>
            <Text style={styles.stepperButtonText}>−</Text>
          </TouchableOpacity>
          <View style={styles.stepperCenter}>
            <Text style={styles.hoursValue}>{hours}</Text>
            <Text style={styles.stepperHint}>{hours === 1 ? 'hora' : 'horas'}</Text>
          </View>
          <TouchableOpacity style={styles.stepperButton} disabled={hours >= MAX_HOURS} onPress={() => setHours(Math.min(MAX_HOURS, hours + 0.5))}>
            <Text style={styles.stepperButtonText}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Motivo (opcional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej. cierre de mes"
          placeholderTextColor="#94a3b8"
          value={notes}
          onChangeText={setNotes}
          maxLength={500}
        />

        <Text style={styles.help}>
          Se paga lo menor entre lo autorizado y lo trabajado. Si ya habia una autorizacion para ese dia, esta la reemplaza.
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={[styles.submit, (!employee || saving) && styles.submitDisabled]} disabled={!employee || saving} onPress={submit}>
          {saving ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.submitText}>{employee ? `Autorizar ${hoursLabel(hours)}` : 'Elige un empleado'}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  label: { fontSize: 12, fontWeight: '700', color: '#475569', marginTop: 16, marginBottom: 6 },
  // Color de texto fijo: con el telefono en modo oscuro lo escrito no puede quedar invisible.
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: '#0f172a', backgroundColor: 'white' },
  noMatches: { color: '#64748b', fontSize: 13, marginTop: 10 },
  matches: { marginTop: 8, backgroundColor: 'white', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  match: { paddingVertical: 10, paddingHorizontal: 12 },
  matchBorder: { borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  matchName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  matchMeta: { fontSize: 12, color: '#64748b', marginTop: 1 },
  selected: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'white', borderRadius: 8, borderWidth: 1, borderColor: '#059669', padding: 12 },
  selectedName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  selectedMeta: { fontSize: 12, color: '#64748b', marginTop: 1 },
  change: { color: '#047857', fontWeight: '700', fontSize: 13 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperButton: { width: 48, height: 48, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white' },
  stepperButtonText: { fontSize: 24, color: '#0f172a', fontWeight: '700' },
  stepperCenter: { flex: 1, alignItems: 'center', backgroundColor: 'white', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 8, minHeight: 48, justifyContent: 'center' },
  stepperValue: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  stepperHint: { fontSize: 11, color: '#64748b' },
  hoursValue: { fontSize: 24, fontWeight: '800', color: '#0f172a' },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quick: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e2e8f0', alignItems: 'center' },
  quickText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  help: { fontSize: 12, color: '#64748b', marginTop: 16 },
  error: { color: '#b91c1c', marginTop: 12 },
  submit: { backgroundColor: '#059669', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 16 },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: 'white', fontWeight: '700', fontSize: 15 },
  secondary: { paddingVertical: 14, alignItems: 'center' },
  secondaryText: { color: '#475569', fontWeight: '600' },
  resultContainer: { padding: 16, justifyContent: 'center' },
  resultCard: { backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#a7f3d0', padding: 16, gap: 10 },
  resultTitle: { fontSize: 17, fontWeight: '800', color: '#047857' },
  resultText: { fontSize: 14, color: '#334155', lineHeight: 20 },
  bold: { fontWeight: '700', color: '#0f172a' },
});
