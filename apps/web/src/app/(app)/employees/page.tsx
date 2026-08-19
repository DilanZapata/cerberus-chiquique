'use client';

import { FormEvent, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Plus, Users, MapPin, ScanFace, Pencil, UserX } from 'lucide-react';
import {
  CompanyInfo,
  Department,
  Employee,
  Position,
  ScheduleSummary,
  WorkSite,
  createDepartment,
  createEmployee,
  createWorkSite,
  updateWorkSite,
  deactivateEmployee,
  getDepartments,
  getEmployees,
  getFaceStatus,
  getMyCompany,
  getPositions,
  getSchedules,
  getWorkSites,
  revokeFace,
  updateEmployee,
  updateMyCompany,
} from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { FaceEnrollPanel } from '@/components/FaceEnrollPanel';

const inputClass =
  'rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-ink-secondary';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  HR: 'Recursos Humanos',
  SUPERVISOR: 'Supervisor',
  EMPLOYEE: 'Empleado',
};

function CompanyCard({ company, onUpdated }: { company: CompanyInfo; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [legalName, setLegalName] = useState(company.legalName);
  const [tradeName, setTradeName] = useState(company.tradeName ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateMyCompany({ legalName, tradeName });
      setEditing(false);
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Building2 size={20} />
        </div>
        {!editing ? (
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink">{company.legalName}</div>
            <div className="text-xs text-ink-muted">
              NIT {company.nit} {company.tradeName && `· ${company.tradeName}`} · <code className="text-ink-muted">{company.id}</code>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 gap-2">
            <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={`flex-1 ${inputClass}`} placeholder="Razon social" />
            <input value={tradeName} onChange={(e) => setTradeName(e.target.value)} className={`flex-1 ${inputClass}`} placeholder="Nombre comercial" />
          </div>
        )}
        {editing ? (
          <Button disabled={saving} onClick={save}>
            Guardar
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Editar
          </Button>
        )}
      </div>
    </Card>
  );
}

function OrgListsCard({
  departments,
  workSites,
  onChanged,
}: {
  departments: Department[];
  workSites: WorkSite[];
  onChanged: () => void;
}) {
  const [deptName, setDeptName] = useState('');
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [siteLat, setSiteLat] = useState('');
  const [siteLng, setSiteLng] = useState('');
  const [busy, setBusy] = useState(false);

  async function addDepartment(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createDepartment(deptName);
      setDeptName('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addWorkSite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createWorkSite({
        name: siteName,
        address: siteAddress || undefined,
        latitude: siteLat ? Number(siteLat) : undefined,
        longitude: siteLng ? Number(siteLng) : undefined,
      });
      setSiteName('');
      setSiteAddress('');
      setSiteLat('');
      setSiteLng('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card className="p-5">
        <div className="text-sm font-semibold text-ink">Departamentos</div>
        <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center justify-between rounded-md bg-surface-page px-2 py-1">
              <span>{d.name}</span>
              <code className="text-xs text-ink-muted">{d.id.slice(0, 8)}</code>
            </li>
          ))}
          {departments.length === 0 && <li className="text-ink-muted">Aun no hay departamentos.</li>}
        </ul>
        <form onSubmit={addDepartment} className="mt-3 flex gap-2">
          <input required value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="ej. Operaciones" className={`flex-1 ${inputClass}`} />
          <Button disabled={busy} variant="secondary">
            <Plus size={15} />
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <MapPin size={15} /> Sedes
        </div>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-secondary">
          {workSites.map((s) => (
            <WorkSiteRow key={s.id} site={s} onChanged={onChanged} />
          ))}
          {workSites.length === 0 && <li className="text-ink-muted">Aun no hay sedes.</li>}
        </ul>
        <form onSubmit={addWorkSite} className="mt-3 space-y-2">
          <input required value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Nombre de la sede" className={`w-full ${inputClass}`} />
          <input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} placeholder="Direccion (opcional)" className={`w-full ${inputClass}`} />
          <div className="flex gap-2">
            <input value={siteLat} onChange={(e) => setSiteLat(e.target.value)} placeholder="Latitud" className={`flex-1 ${inputClass}`} />
            <input value={siteLng} onChange={(e) => setSiteLng(e.target.value)} placeholder="Longitud" className={`flex-1 ${inputClass}`} />
            <Button disabled={busy} variant="secondary" type="submit">
              <Plus size={15} />
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/**
 * Las coordenadas y el radio GPS de una sede son criticos: de ahi depende
 * tanto el marcaje de autoservicio movil como que el kiosco identifique en
 * que sede esta parado (ver docs/architecture.md), asi que deben poder
 * corregirse despues de creada la sede, no solo al crearla.
 */
function WorkSiteRow({ site, onChanged }: { site: WorkSite; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(site.name);
  const [address, setAddress] = useState(site.address ?? '');
  const [latitude, setLatitude] = useState(site.latitude ?? '');
  const [longitude, setLongitude] = useState(site.longitude ?? '');
  const [gpsRadiusMeters, setGpsRadiusMeters] = useState(String(site.gpsRadiusMeters));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateWorkSite(site.id, {
        name,
        address: address || undefined,
        latitude: latitude !== '' ? Number(latitude) : undefined,
        longitude: longitude !== '' ? Number(longitude) : undefined,
        gpsRadiusMeters: gpsRadiusMeters !== '' ? Number(gpsRadiusMeters) : undefined,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <li className="rounded-md bg-surface-page px-2 py-1.5">
        <div className="flex items-center justify-between">
          <span>{site.name}</span>
          <button onClick={() => setEditing(true)} className="text-ink-muted hover:text-ink" title="Editar sede">
            <Pencil size={13} />
          </button>
        </div>
        {(site.latitude || site.address) && (
          <div className="mt-0.5 text-xs text-ink-muted">
            {site.address && <span>{site.address} · </span>}
            {site.latitude && site.longitude && (
              <span>
                {site.latitude}, {site.longitude} (radio {site.gpsRadiusMeters}m)
              </span>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <li className="rounded-md border border-brand-100 bg-surface-card p-2.5">
      <form onSubmit={save} className="space-y-2">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la sede" className={`w-full ${inputClass}`} />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Direccion (opcional)" className={`w-full ${inputClass}`} />
        <div className="flex gap-2">
          <input value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="Latitud" className={`flex-1 ${inputClass}`} />
          <input value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="Longitud" className={`flex-1 ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Radio GPS permitido (metros)</label>
          <input
            type="number"
            min={10}
            value={gpsRadiusMeters}
            onChange={(e) => setGpsRadiusMeters(e.target.value)}
            className={`mt-1 w-full ${inputClass}`}
          />
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
        <div className="flex gap-2">
          <Button disabled={saving} variant="success" type="submit" className="flex-1">
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
          <Button
            disabled={saving}
            variant="secondary"
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="flex-1"
          >
            Cancelar
          </Button>
        </div>
      </form>
    </li>
  );
}

/**
 * Si la empresa tiene una sola sede, se asigna automaticamente (no tiene
 * sentido preguntar cuando solo hay una respuesta posible). Con 2+ sedes,
 * la seleccion pasa a ser obligatoria porque ahi si importa distinguir.
 */
function WorkSiteField({
  workSites,
  value,
  onChange,
}: {
  workSites: WorkSite[];
  value: string;
  onChange: (id: string) => void;
}) {
  useEffect(() => {
    if (workSites.length === 1 && value !== workSites[0].id) {
      onChange(workSites[0].id);
    }
  }, [workSites, value, onChange]);

  if (workSites.length === 0) return null;

  if (workSites.length === 1) {
    return (
      <div>
        <label className={labelClass}>Sede</label>
        <div className={`mt-1 w-full ${inputClass} bg-surface-page text-ink-muted`}>{workSites[0].name}</div>
      </div>
    );
  }

  return (
    <div>
      <label className={labelClass}>Sede</label>
      <select required value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 w-full ${inputClass}`}>
        <option value="" disabled>
          Selecciona una sede...
        </option>
        {workSites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function CreateEmployeeForm({
  departments,
  workSites,
  positions,
  schedules,
  onCreated,
  onCancel,
}: {
  departments: Department[];
  workSites: WorkSite[];
  positions: Position[];
  schedules: ScheduleSummary[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [employeeCode, setEmployeeCode] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('EMPLOYEE');
  const [departmentId, setDepartmentId] = useState('');
  const [workSiteId, setWorkSiteId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [baseSalary, setBaseSalary] = useState('');
  const [allowsLunchSkip, setAllowsLunchSkip] = useState(false);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createEmployee({
        employeeCode,
        nationalId,
        fullName,
        email: email || undefined,
        role,
        departmentId: departmentId || undefined,
        workSiteId: workSiteId || undefined,
        positionId: positionId || undefined,
        scheduleId: scheduleId || undefined,
        hireDate,
        baseSalary: baseSalary ? Number(baseSalary) : undefined,
        allowsLunchSkip,
        password: password || undefined,
        pin: pin || undefined,
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold text-ink">Nuevo empleado</div>
      <form onSubmit={handleSubmit} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Codigo de empleado</label>
          <input required value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Cedula</label>
          <input required value={nationalId} onChange={(e) => setNationalId(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Nombre completo</label>
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Correo (opcional, necesario para login web)</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Rol</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={`mt-1 w-full ${inputClass}`}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Departamento</label>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={`mt-1 w-full ${inputClass}`}>
            <option value="">Sin asignar</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <WorkSiteField workSites={workSites} value={workSiteId} onChange={setWorkSiteId} />
        <div>
          <label className={labelClass}>Cargo (define su horario de entrada/salida)</label>
          <select value={positionId} onChange={(e) => setPositionId(e.target.value)} className={`mt-1 w-full ${inputClass}`}>
            <option value="">Sin cargo asignado</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.schedule ? ` (${p.schedule.name})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Horario individual (opcional, anula el del cargo)</label>
          <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} className={`mt-1 w-full ${inputClass}`}>
            <option value="">Usar el del cargo</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Fecha de ingreso</label>
          <input required type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Salario base</label>
          <input type="number" min={0} value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <input type="checkbox" checked={allowsLunchSkip} onChange={(e) => setAllowsLunchSkip(e.target.checked)} />
            Puede omitir el almuerzo (adelanta su salida)
          </label>
        </div>
        <div>
          <label className={labelClass}>Contrasena (opcional, para el panel web)</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>PIN de kiosco (4-6 digitos, opcional)</label>
          <input value={pin} onChange={(e) => setPin(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>

        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 sm:col-span-2">{error}</p>}

        <div className="flex gap-2 sm:col-span-2">
          <Button disabled={saving} className="flex-1">
            {saving ? 'Creando...' : 'Crear empleado'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function EditEmployeeForm({
  employee,
  departments,
  workSites,
  positions,
  onSaved,
  onCancel,
}: {
  employee: Employee;
  departments: Department[];
  workSites: WorkSite[];
  positions: Position[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(employee.fullName);
  const [email, setEmail] = useState(employee.email ?? '');
  const [role, setRole] = useState(employee.role);
  const [departmentId, setDepartmentId] = useState(employee.department?.id ?? '');
  const [workSiteId, setWorkSiteId] = useState(employee.workSite?.id ?? '');
  const [positionId, setPositionId] = useState(employee.position?.id ?? '');
  const [baseSalary, setBaseSalary] = useState(employee.baseSalary ?? '');
  const [allowsLunchSkip, setAllowsLunchSkip] = useState(employee.allowsLunchSkip);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateEmployee(employee.id, {
        fullName,
        email: email || undefined,
        role,
        departmentId: departmentId || undefined,
        workSiteId: workSiteId || undefined,
        positionId: positionId || undefined,
        baseSalary: baseSalary !== '' ? Number(baseSalary) : undefined,
        allowsLunchSkip,
        password: password || undefined,
        pin: pin || undefined,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold text-ink">Editar {employee.fullName}</div>
      <form onSubmit={handleSubmit} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Nombre completo</label>
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Correo (necesario para login web)</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Rol</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={`mt-1 w-full ${inputClass}`}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Departamento</label>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={`mt-1 w-full ${inputClass}`}>
            <option value="">Sin asignar</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <WorkSiteField workSites={workSites} value={workSiteId} onChange={setWorkSiteId} />
        <div>
          <label className={labelClass}>Cargo (define su horario de entrada/salida)</label>
          <select value={positionId} onChange={(e) => setPositionId(e.target.value)} className={`mt-1 w-full ${inputClass}`}>
            <option value="">Sin cargo asignado</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.schedule ? ` (${p.schedule.name})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Salario base</label>
          <input type="number" min={0} value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <input type="checkbox" checked={allowsLunchSkip} onChange={(e) => setAllowsLunchSkip(e.target.checked)} />
            Puede omitir el almuerzo (adelanta su salida)
          </label>
        </div>
        <div>
          <label className={labelClass}>Nueva contrasena (dejar en blanco para no cambiarla)</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Nuevo PIN de kiosco (dejar en blanco para no cambiarlo)</label>
          <input value={pin} onChange={(e) => setPin(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>

        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 sm:col-span-2">{error}</p>}

        <div className="flex gap-2 sm:col-span-2">
          <Button disabled={saving} className="flex-1">
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function EmployeesPage() {
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [workSites, setWorkSites] = useState<WorkSite[]>([]);
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [faceEnrolled, setFaceEnrolled] = useState<Record<string, boolean>>({});
  const [enrollingUserId, setEnrollingUserId] = useState<string | null>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);

  function loadAll() {
    setLoading(true);
    setError(null);
    Promise.all([getMyCompany(), getDepartments(), getWorkSites(), getSchedules(), getPositions(), getEmployees()])
      .then(async ([c, d, w, s, p, e]) => {
        setCompany(c);
        setDepartments(d);
        setWorkSites(w);
        setSchedules(s);
        setPositions(p);
        setEmployees(e);
        const statuses = await Promise.all(e.map((emp) => getFaceStatus(emp.id).catch(() => ({ enrolled: false }))));
        setFaceEnrolled(Object.fromEntries(e.map((emp, i) => [emp.id, statuses[i].enrolled])));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(loadAll, []);

  async function handleDeactivate(id: string) {
    setBusyId(id);
    try {
      await deactivateEmployee(id);
      loadAll();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevokeFace(id: string) {
    setBusyId(id);
    try {
      await revokeFace(id);
      setFaceEnrolled((prev) => ({ ...prev, [id]: false }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empleados"
        subtitle="Tu empresa, departamentos, sedes y el personal registrado en el sistema."
        actions={
          <Button onClick={() => setShowCreateForm((v) => !v)}>
            <Plus size={16} />
            Nuevo empleado
          </Button>
        }
      />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-ink-muted">Cargando...</p>}

      {!loading && company && <CompanyCard company={company} onUpdated={loadAll} />}
      {!loading && <OrgListsCard departments={departments} workSites={workSites} onChanged={loadAll} />}

      <AnimatePresence>
        {showCreateForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <CreateEmployeeForm
              departments={departments}
              workSites={workSites}
              positions={positions}
              schedules={schedules}
              onCreated={() => {
                setShowCreateForm(false);
                loadAll();
              }}
              onCancel={() => setShowCreateForm(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {enrollingUserId && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <FaceEnrollPanel
              userId={enrollingUserId}
              fullName={employees.find((e) => e.id === enrollingUserId)?.fullName ?? ''}
              onDone={() => {
                setFaceEnrolled((prev) => ({ ...prev, [enrollingUserId]: true }));
                setEnrollingUserId(null);
              }}
              onCancel={() => setEnrollingUserId(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingEmployeeId && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <EditEmployeeForm
              employee={employees.find((e) => e.id === editingEmployeeId)!}
              departments={departments}
              workSites={workSites}
              positions={positions}
              onSaved={() => {
                setEditingEmployeeId(null);
                loadAll();
              }}
              onCancel={() => setEditingEmployeeId(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-0 text-sm font-semibold text-ink">
          <Users size={16} /> {employees.length} empleado(s)
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line-hair text-sm">
            <thead className="bg-surface-page">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Empleado</th>
                <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Rol</th>
                <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Departamento</th>
                <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Cargo</th>
                <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Sede</th>
                <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Estado</th>
                <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Rostro</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hair">
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-ink">{emp.fullName}</div>
                    <div className="text-xs text-ink-muted">
                      {emp.employeeCode} · <code>{emp.id}</code>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-ink-secondary">{ROLE_LABELS[emp.role] ?? emp.role}</td>
                  <td className="px-4 py-2 text-ink-secondary">{emp.department?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-ink-secondary">{emp.position?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-ink-secondary">{emp.workSite?.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Badge tone={emp.isActive ? 'good' : 'neutral'}>{emp.isActive ? 'Activo' : 'Inactivo'}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    {faceEnrolled[emp.id] ? (
                      <Badge tone="good">
                        <ScanFace size={12} className="mr-1 inline" /> Enrolado
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Sin enrolar</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="secondary" className="!px-2" title="Editar" onClick={() => setEditingEmployeeId(emp.id)}>
                        <Pencil size={15} />
                      </Button>
                      {faceEnrolled[emp.id] ? (
                        <Button
                          variant="secondary"
                          className="!px-2"
                          title="Revocar rostro"
                          disabled={busyId === emp.id}
                          onClick={() => handleRevokeFace(emp.id)}
                        >
                          <ScanFace size={15} className="text-red-600" />
                        </Button>
                      ) : (
                        <Button variant="secondary" className="!px-2" title="Enrolar rostro" onClick={() => setEnrollingUserId(emp.id)}>
                          <ScanFace size={15} />
                        </Button>
                      )}
                      {emp.isActive && (
                        <Button
                          variant="danger"
                          className="!px-2"
                          title="Desactivar"
                          disabled={busyId === emp.id}
                          onClick={() => handleDeactivate(emp.id)}
                        >
                          <UserX size={15} />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
