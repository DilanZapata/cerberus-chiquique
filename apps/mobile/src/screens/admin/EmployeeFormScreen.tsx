import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import {
  createEmployee,
  Department,
  Employee,
  getDepartments,
  getEmployees,
  getWorkSites,
  updateEmployee,
  WorkSite,
} from '../../services/api';

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'EMPLOYEE', label: 'Empleado' },
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'HR', label: 'RRHH' },
  { value: 'ADMIN', label: 'Administrador' },
];

type Props = NativeStackScreenProps<RootStackParamList, 'AdminEmployeeForm'>;

export default function EmployeeFormScreen({ route, navigation }: Props) {
  const employeeId = route.params?.employeeId;
  const isEdit = !!employeeId;
  const { session } = useAuth();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [workSites, setWorkSites] = useState<WorkSite[]>([]);

  const [employeeCode, setEmployeeCode] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('EMPLOYEE');
  const [departmentId, setDepartmentId] = useState('');
  const [workSiteId, setWorkSiteId] = useState('');
  const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10));
  const [baseSalary, setBaseSalary] = useState('');
  const [allowsLunchSkip, setAllowsLunchSkip] = useState(false);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    Promise.all([getDepartments(session.accessToken), getWorkSites(session.accessToken), isEdit ? getEmployees(session.accessToken) : Promise.resolve([])])
      .then(([depts, sites, employees]) => {
        setDepartments(depts);
        setWorkSites(sites);
        if (isEdit) {
          const emp = (employees as Employee[]).find((e) => e.id === employeeId);
          if (emp) {
            setFullName(emp.fullName);
            setEmail(emp.email ?? '');
            setRole(emp.role);
            setDepartmentId(emp.department?.id ?? '');
            setWorkSiteId(emp.workSite?.id ?? '');
            setBaseSalary(emp.baseSalary ?? '');
            setAllowsLunchSkip(emp.allowsLunchSkip);
            setEmployeeCode(emp.employeeCode);
            setNationalId(emp.nationalId);
          }
        }
        if (sites.length === 1) setWorkSiteId(sites[0].id);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [session, isEdit, employeeId]);

  async function handleSubmit() {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await updateEmployee(session.accessToken, employeeId!, {
          fullName,
          email: email || undefined,
          role,
          departmentId: departmentId || undefined,
          workSiteId: workSiteId || undefined,
          baseSalary: baseSalary ? Number(baseSalary) : undefined,
          allowsLunchSkip,
          password: password || undefined,
          pin: pin || undefined,
        });
      } else {
        await createEmployee(session.accessToken, {
          employeeCode,
          nationalId,
          fullName,
          email: email || undefined,
          role,
          departmentId: departmentId || undefined,
          workSiteId: workSiteId || undefined,
          hireDate,
          baseSalary: baseSalary ? Number(baseSalary) : undefined,
          allowsLunchSkip,
          password: password || undefined,
          pin: pin || undefined,
        });
      }
      navigation.goBack();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{isEdit ? 'Editar empleado' : 'Nuevo empleado'}</Text>

      {!isEdit && (
        <>
          <Field label="Codigo de empleado" value={employeeCode} onChangeText={setEmployeeCode} autoCapitalize="characters" />
          <Field label="Cedula" value={nationalId} onChangeText={setNationalId} keyboardType="number-pad" />
        </>
      )}
      <Field label="Nombre completo" value={fullName} onChangeText={setFullName} />
      <Field label="Correo (para login web/mobile)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />

      <Text style={styles.label}>Rol</Text>
      <View style={styles.chipRow}>
        {ROLE_OPTIONS.map((opt) => (
          <TouchableOpacity key={opt.value} style={[styles.chip, role === opt.value && styles.chipActive]} onPress={() => setRole(opt.value)}>
            <Text style={[styles.chipText, role === opt.value && styles.chipTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Departamento</Text>
      <View style={styles.chipRow}>
        <TouchableOpacity style={[styles.chip, !departmentId && styles.chipActive]} onPress={() => setDepartmentId('')}>
          <Text style={[styles.chipText, !departmentId && styles.chipTextActive]}>Sin asignar</Text>
        </TouchableOpacity>
        {departments.map((d) => (
          <TouchableOpacity key={d.id} style={[styles.chip, departmentId === d.id && styles.chipActive]} onPress={() => setDepartmentId(d.id)}>
            <Text style={[styles.chipText, departmentId === d.id && styles.chipTextActive]}>{d.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {workSites.length > 1 && (
        <>
          <Text style={styles.label}>Sede</Text>
          <View style={styles.chipRow}>
            {workSites.map((s) => (
              <TouchableOpacity key={s.id} style={[styles.chip, workSiteId === s.id && styles.chipActive]} onPress={() => setWorkSiteId(s.id)}>
                <Text style={[styles.chipText, workSiteId === s.id && styles.chipTextActive]}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {!isEdit && <Field label="Fecha de ingreso (AAAA-MM-DD)" value={hireDate} onChangeText={setHireDate} />}
      <Field label="Salario base" value={baseSalary} onChangeText={setBaseSalary} keyboardType="number-pad" />

      <View style={styles.switchRow}>
        <Text style={styles.label}>Puede omitir el almuerzo</Text>
        <Switch value={allowsLunchSkip} onValueChange={setAllowsLunchSkip} />
      </View>

      <Field
        label={isEdit ? 'Nueva contrasena (dejar en blanco para no cambiar)' : 'Contrasena (opcional, panel web)'}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Field
        label={isEdit ? 'Nuevo PIN (dejar en blanco para no cambiar)' : 'PIN de kiosco (4-6 digitos, opcional)'}
        value={pin}
        onChangeText={setPin}
        keyboardType="number-pad"
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.submit} onPress={handleSubmit} disabled={saving || !fullName}>
        {saving ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>{isEdit ? 'Guardar cambios' : 'Crear empleado'}</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  autoCapitalize?: 'none' | 'characters';
  keyboardType?: 'default' | 'number-pad' | 'email-address';
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        keyboardType={props.keyboardType ?? 'default'}
        secureTextEntry={props.secureTextEntry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 6, paddingBottom: 60 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  field: { marginBottom: 6 },
  label: { fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 4, marginTop: 6 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, fontSize: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  chipText: { fontSize: 12, color: '#0f172a' },
  chipTextActive: { color: 'white' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  error: { color: '#b91c1c', textAlign: 'center', marginTop: 8 },
  submit: { backgroundColor: '#0f172a', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 18 },
  submitText: { color: 'white', fontWeight: '700', fontSize: 16 },
});
