'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, ChevronDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  Department,
  Employee,
  ShiftPattern,
  ShiftPatternDayInput,
  SmartRotationResult,
  assignPatternToTeam,
  createShiftPattern,
  generateShifts,
  getDepartments,
  getEmployees,
  getShiftPatterns,
  smartGenerateShiftPattern,
} from '@/lib/api';
import { getCompanyId } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const inputClass =
  'rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-ink-secondary';

const SLOT_COLORS = [
  'bg-series-blue/15 text-series-blue',
  'bg-series-aqua/15 text-series-aqua',
  'bg-series-yellow/20 text-[#8a6600]',
  'bg-series-violet/15 text-series-violet',
  'bg-series-green/15 text-series-green',
  'bg-series-red/15 text-series-red',
  'bg-series-magenta/20 text-series-magenta',
  'bg-series-orange/15 text-series-orange',
];

function emptyDay(offset: number): ShiftPatternDayInput {
  return { dayOffset: offset, isRestDay: false, rotationType: 'DIURNO', startTime: '08:00', endTime: '17:00', lunchMinutes: 60 };
}

function SmartRotationGenerator({ companyId, employees }: { companyId: string; employees: Employee[] }) {
  const [name, setName] = useState('');
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [coverageStart, setCoverageStart] = useState('06:00');
  const [coverageEnd, setCoverageEnd] = useState('22:00');
  const [shiftHours, setShiftHours] = useState(8);
  const [restDaysPerWeek, setRestDaysPerWeek] = useState(1);
  const [anchorDate, setAnchorDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SmartRotationResult | null>(null);

  function toggleWorker(id: string) {
    setSelectedWorkerIds((prev) => (prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const plan = await smartGenerateShiftPattern(companyId, {
        name,
        workerIds: selectedWorkerIds,
        coverageStart,
        coverageEnd,
        shiftHours,
        restDaysPerWeek,
        anchorDate,
      });
      setResult(plan);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Sparkles size={20} />
        </div>
        <div>
          <div className="text-sm font-semibold text-ink">Generador inteligente de rutinas</div>
          <div className="text-xs text-ink-muted">
            Dile cuantas personas y que horario debe cubrirse; el sistema calcula los turnos y los descansos por ti.
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Nombre de la rutina</label>
          <input
            required
            placeholder="ej. Rotativo Recepcion"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`mt-1 w-full ${inputClass}`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Trabajadores ({selectedWorkerIds.length} seleccionados)</label>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line-axis bg-surface-card p-2">
            {employees.length === 0 && (
              <p className="p-2 text-sm text-ink-muted">No hay empleados activos. Crea empleados primero en la seccion Empleados.</p>
            )}
            {employees.map((emp) => (
              <label key={emp.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-secondary hover:bg-surface-page">
                <input type="checkbox" checked={selectedWorkerIds.includes(emp.id)} onChange={() => toggleWorker(emp.id)} />
                {emp.fullName} <span className="text-xs text-ink-muted">({emp.employeeCode})</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Cobertura desde</label>
          <input required type="time" value={coverageStart} onChange={(e) => setCoverageStart(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Cobertura hasta</label>
          <input required type="time" value={coverageEnd} onChange={(e) => setCoverageEnd(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Duracion de cada turno (horas)</label>
          <input
            required
            type="number"
            min={1}
            max={24}
            value={shiftHours}
            onChange={(e) => setShiftHours(Number(e.target.value))}
            className={`mt-1 w-full ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass}>Descansos por semana (si aplica)</label>
          <input
            type="number"
            min={0}
            max={6}
            value={restDaysPerWeek}
            onChange={(e) => setRestDaysPerWeek(Number(e.target.value))}
            className={`mt-1 w-full ${inputClass}`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Fecha de inicio</label>
          <input required type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </div>

        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 sm:col-span-2">{error}</p>}

        <Button disabled={submitting || selectedWorkerIds.length === 0} className="sm:col-span-2">
          {submitting ? 'Calculando la mejor rotacion...' : 'Generar rutina automaticamente'}
        </Button>
      </form>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-6 border-t border-line-hair pt-5">
              {result.warnings.length > 0 && (
                <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div>{result.warnings.join(' ')}</div>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <CheckCircle2 size={16} className="text-emerald-500" />
                {result.slots.length} turno(s) calculado(s) — ciclo de {result.cycleLengthDays} dias
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {result.slots.map((slot, i) => (
                  <span key={slot.index} className={`rounded-full px-3 py-1 text-xs font-medium ${SLOT_COLORS[i % SLOT_COLORS.length]}`}>
                    Turno {i + 1}: {slot.startTime} - {slot.endTime} ({slot.rotationType})
                  </span>
                ))}
              </div>

              <div className="mt-4 overflow-x-auto rounded-lg border border-line-hair">
                <table className="min-w-full text-sm">
                  <thead className="bg-surface-page">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-ink-secondary">Trabajador</th>
                      {Array.from({ length: result.cycleLengthDays }, (_, d) => (
                        <th key={d} className="px-2 py-2 text-center font-semibold text-ink-secondary">
                          Dia {d}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-hair">
                    {result.workers.map((w) => (
                      <tr key={w.userId}>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">{w.fullName}</td>
                        {Array.from({ length: result.cycleLengthDays }, (_, d) => {
                          const isRest = w.restDayOffsets.includes(d);
                          return (
                            <td key={d} className="px-1.5 py-1.5 text-center">
                              {isRest ? (
                                <span className="inline-block rounded-md bg-surface-page px-2 py-1 text-xs text-ink-muted">Descanso</span>
                              ) : (
                                <span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${SLOT_COLORS[w.slotIndex % SLOT_COLORS.length]}`}>
                                  {w.slot.startTime}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-ink-muted">
                Se crearon {result.workers.length} plantilla(s) (una por trabajador) y ya se generaron los turnos concretos
                para las proximas semanas.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function ManualPatternTools({
  companyId,
  patterns,
  departments,
  onChanged,
}: {
  companyId: string;
  patterns: ShiftPattern[];
  departments: Department[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [cycleLengthDays, setCycleLengthDays] = useState(7);
  const [days, setDays] = useState<ShiftPatternDayInput[]>(Array.from({ length: 7 }, (_, i) => emptyDay(i)));

  const [departmentId, setDepartmentId] = useState('');
  const [anchorDate, setAnchorDate] = useState('');
  const [staggerDays, setStaggerDays] = useState(0);
  const [selectedPatternId, setSelectedPatternId] = useState('');
  const [generateFrom, setGenerateFrom] = useState('');
  const [generateTo, setGenerateTo] = useState('');

  useEffect(() => {
    setDays((prev) => Array.from({ length: cycleLengthDays }, (_, i) => prev[i] ?? emptyDay(i)));
  }, [cycleLengthDays]);

  function updateDay(index: number, patch: Partial<ShiftPatternDayInput>) {
    setDays((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  async function handleCreatePattern(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      await createShiftPattern(companyId, { name, cycleLengthDays, days });
      setStatus(`Rutina "${name}" creada.`);
      setName('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAssign(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const result = await assignPatternToTeam(selectedPatternId, { departmentId, anchorDate, staggerDays: staggerDays || undefined });
      setStatus(`Rutina asignada a ${result.assignedCount} empleados del equipo.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const result = await generateShifts({ departmentId, from: generateFrom, to: generateTo });
      setStatus(`${result.generated} turnos generados en el rango seleccionado.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card className="p-5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <div className="text-sm font-semibold text-ink">Modo manual (avanzado)</div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronDown size={18} className="text-ink-muted" />
        </motion.div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-5 space-y-5 border-t border-line-hair pt-5">
              {status && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{status}</p>}
              {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

              {patterns.length > 0 && (
                <ul className="space-y-1 text-sm text-ink-secondary">
                  {patterns.map((p) => (
                    <li key={p.id}>
                      <code className="text-xs text-ink-muted">{p.id}</code> — {p.name} ({p.cycleLengthDays} dias)
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={handleCreatePattern} className="space-y-3">
                <div className="text-sm font-medium text-ink-secondary">Crear rutina dia por dia</div>
                <div className="flex gap-3">
                  <input required placeholder="Nombre (ej. Rotativo 4x3)" value={name} onChange={(e) => setName(e.target.value)} className={`flex-1 ${inputClass}`} />
                  <input
                    type="number"
                    min={1}
                    value={cycleLengthDays}
                    onChange={(e) => setCycleLengthDays(Math.max(1, Number(e.target.value)))}
                    className={`w-28 ${inputClass}`}
                  />
                </div>
                <div className="space-y-2">
                  {days.map((day, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="w-14 text-ink-muted">Dia {i}</span>
                      <label className="flex items-center gap-1 text-ink-secondary">
                        <input type="checkbox" checked={day.isRestDay} onChange={(e) => updateDay(i, { isRestDay: e.target.checked })} />
                        Descanso
                      </label>
                      {!day.isRestDay && (
                        <>
                          <select
                            value={day.rotationType}
                            onChange={(e) => updateDay(i, { rotationType: e.target.value as ShiftPatternDayInput['rotationType'] })}
                            className={`px-2 py-1 ${inputClass}`}
                          >
                            <option value="DIURNO">Diurno</option>
                            <option value="NOCTURNO">Nocturno</option>
                            <option value="MIXTO">Mixto</option>
                          </select>
                          <input type="time" value={day.startTime} onChange={(e) => updateDay(i, { startTime: e.target.value })} className={`px-2 py-1 ${inputClass}`} />
                          <span className="text-ink-muted">a</span>
                          <input type="time" value={day.endTime} onChange={(e) => updateDay(i, { endTime: e.target.value })} className={`px-2 py-1 ${inputClass}`} />
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <Button className="w-full">Crear rutina</Button>
              </form>

              <form onSubmit={handleAssign} className="space-y-3 border-t border-line-hair pt-5">
                <div className="text-sm font-medium text-ink-secondary">Asignar rutina a un equipo</div>
                <input required placeholder="ID de la rutina" value={selectedPatternId} onChange={(e) => setSelectedPatternId(e.target.value)} className={`w-full ${inputClass}`} />
                <div className="flex flex-wrap gap-3">
                  <select required value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={`flex-1 ${inputClass}`}>
                    <option value="">Selecciona un departamento</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <input required type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className={inputClass} />
                  <input type="number" min={0} title="Dias de desfase por integrante" value={staggerDays} onChange={(e) => setStaggerDays(Number(e.target.value))} className={`w-24 ${inputClass}`} />
                </div>
                <Button className="w-full">Asignar a equipo</Button>
              </form>

              <form onSubmit={handleGenerate} className="space-y-3 border-t border-line-hair pt-5">
                <div className="text-sm font-medium text-ink-secondary">Generar turnos para el departamento</div>
                <div className="flex gap-3">
                  <input required type="date" value={generateFrom} onChange={(e) => setGenerateFrom(e.target.value)} className={`flex-1 ${inputClass}`} />
                  <input required type="date" value={generateTo} onChange={(e) => setGenerateTo(e.target.value)} className={`flex-1 ${inputClass}`} />
                </div>
                <Button variant="success" className="w-full">
                  Generar turnos
                </Button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

export default function ShiftPatternsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  function loadPatterns(id: string) {
    getShiftPatterns(id).then(setPatterns).catch(() => setPatterns([]));
  }

  useEffect(() => {
    const id = getCompanyId();
    setCompanyId(id);
    if (!id) return;
    loadPatterns(id);
    getEmployees().then((all) => setEmployees(all.filter((e) => e.isActive)));
    getDepartments().then(setDepartments);
  }, []);

  if (!companyId) return <p className="text-sm text-ink-muted">Cargando...</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rutinas de Turnos Rotativos"
        subtitle="Describe la cobertura que necesitas y deja que el sistema calcule la mejor rotacion, con turnos generados automaticamente."
      />

      <SmartRotationGenerator companyId={companyId} employees={employees} />
      <ManualPatternTools companyId={companyId} patterns={patterns} departments={departments} onChanged={() => loadPatterns(companyId)} />
    </div>
  );
}
