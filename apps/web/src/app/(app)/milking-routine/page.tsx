'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Milk, AlertTriangle, CheckCircle2, Eye, Save, Power, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import {
  Employee,
  MilkingRosterCell,
  MilkingRosterResult,
  MilkingRosterRole,
  MilkingRosterView,
  MilkingRoutine,
  deleteMilkingRoutine,
  enableMilkingRoutine,
  getEmployees,
  getMilkingRoutines,
  milkingRoster,
} from '@/lib/api';
import { getCompanyId } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const inputClass =
  'rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-ink-secondary';

const ROLE_OPTIONS: Array<{ value: MilkingRosterRole; label: string; help: string }> = [
  { value: 'ORDENADOR', label: 'Ordeñador fijo', help: 'Siempre en su ordeño.' },
  { value: 'RELEVO', label: 'Ordeñador de relevo', help: 'Es de un ordeño, pero es el primero que cruza al otro cuando allá falta gente.' },
  { value: 'VAQUERO', label: 'Vaquero', help: 'Siempre en su vaquería. Su media jornada la hace ordeñando.' },
  { value: 'COMODIN', label: 'Comodín', help: 'Cubre la vaquería cuando el vaquero descansa, o el ordeño que más lo necesite.' },
];

// Colores de la planilla, como la hoja de la finca: un color por ordeño (el
// del sitio donde se trabaja ese dia), amarillo la media jornada, blanco el descanso.
const STATION_COLORS = ['#f5c6ec', '#b5e8c1', '#bcdaf8', '#d8ccf6', '#bdebe0', '#f9d3bd'];
const SHORT_DAY_COLOR = '#fff34a';

// La planilla necesita mas ancho que el resto de la pagina para que las dos
// semanas quepan lado a lado: en pantallas anchas la tarjeta se sale del ancho
// maximo del contenido (queda centrada en el espacio a la derecha del menu).
// (Con margen negativo y no con transform: la tarjeta ya usa transform para su animacion.)
const WIDE_CARD =
  'min-[1500px]:w-[min(100vw-18.5rem,1500px)] min-[1500px]:max-w-none min-[1500px]:ml-[calc((100%-min(100vw-18.5rem,1500px))/2)]';

const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

interface WorkerSetup {
  role: MilkingRosterRole;
  homeStation: number;
  /** '' = que lo escoja el sistema; si no, dia 0..6 de la semana A (0 = lunes). */
  shortDay: string;
}

function parseDay(dateKey: string): Date {
  return new Date(`${dateKey.slice(0, 10)}T00:00:00`);
}

function toKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(dateKey: string, days: number): string {
  const d = parseDay(dateKey);
  d.setDate(d.getDate() + days);
  return toKey(d);
}

/** "lunes 23 nov" */
function longDate(dateKey: string): string {
  const d = parseDay(dateKey);
  return `${WEEKDAY_LABELS[d.getDay()].toLowerCase()} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

function shortDate(dateKey: string): string {
  const d = parseDay(dateKey);
  return `${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

/** El ciclo siempre empieza en lunes: dia 0 = lunes de la semana A. */
function cycleWeekday(dayOffset: number): string {
  return WEEKDAY_LABELS[(1 + dayOffset) % 7];
}

/** El lunes mas cercano de hoy en adelante (hoy, si hoy es lunes). */
function nextMonday(): string {
  const today = new Date();
  today.setDate(today.getDate() + ((8 - today.getDay()) % 7));
  return toKey(today);
}

function cellHours(cell: MilkingRosterCell): number {
  return cell.kind === 'COMPLETO' ? 8 : cell.kind === 'CORTO' ? 4 : 0;
}

type RosterWorker = MilkingRosterView['workers'][number];

/** Orden de la planilla: por ordeño (ordeñadores y luego su vaquero) y los comodines al final. */
function sheetOrder(workers: RosterWorker[]): RosterWorker[] {
  const rank = (w: RosterWorker) => (w.role === 'COMODIN' ? 1e6 : (w.homeStation ?? 0) * 10 + (w.role === 'VAQUERO' ? 1 : 0));
  return workers.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i).map((x) => x.w);
}

function locationLabel(worker: RosterWorker, stationsCount: number): string {
  if (worker.role === 'COMODIN') return 'COMODÍN';
  const number = stationsCount > 1 ? ` ${(worker.homeStation ?? 0) + 1}` : '';
  return worker.role === 'VAQUERO' ? `Vaquería${number}` : `ORDEÑO${number}`;
}

/**
 * Texto de la casilla, igual que en la hoja: en su propio puesto solo las
 * horas ("8", o "8 VAQ" el vaquero); si ese dia esta en otro sitio se dice
 * cual ("8 ORD 1", "8 VAQ 2"); la media jornada siempre dice donde ("4 ORD 1").
 */
function sheetCellText(worker: RosterWorker, cell: MilkingRosterCell, stationsCount: number): string {
  if (cell.kind === 'DESCANSO' || cell.station === null) return 'DESCANSO';
  const number = stationsCount > 1 ? ` ${cell.station + 1}` : '';
  if (cell.kind === 'CORTO') return `4 ORD${number}`;
  const atHome = worker.role !== 'COMODIN' && worker.homeStation === cell.station;
  if (cell.post === 'VAQUERIA') return atHome && worker.role === 'VAQUERO' ? '8 VAQ' : `8 VAQ${number}`;
  return atHome && worker.role !== 'VAQUERO' ? '8' : `8 ORD${number}`;
}

export default function MilkingRoutinePage() {
  const [companyId, setCompanyId] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [routines, setRoutines] = useState<MilkingRoutine[]>([]);
  const [routinesLoaded, setRoutinesLoaded] = useState(false);

  // Formulario para armar una rutina nueva.
  const [name, setName] = useState('');
  const [stationsCount, setStationsCount] = useState(2);
  const [setupById, setSetupById] = useState<Record<string, WorkerSetup>>({});
  const [morningStart, setMorningStart] = useState('04:00');
  const [morningEnd, setMorningEnd] = useState('08:00');
  const [eveningStart, setEveningStart] = useState('16:00');
  const [eveningEnd, setEveningEnd] = useState('20:00');
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MilkingRosterResult | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const reloadRoutines = useCallback((id: string) => {
    return getMilkingRoutines(id)
      .then(setRoutines)
      .catch(() => {})
      .finally(() => setRoutinesLoaded(true));
  }, []);

  useEffect(() => {
    const id = getCompanyId();
    if (id) {
      setCompanyId(id);
      reloadRoutines(id);
    }
    getEmployees()
      .then(setEmployees)
      .catch(() => {});
  }, [reloadRoutines]);

  const selected = useMemo(() => employees.filter((e) => setupById[e.id]), [employees, setupById]);

  function clearResult() {
    setResult(null);
    setSavedNotice(null);
  }

  function toggleWorker(id: string) {
    clearResult();
    setSetupById((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = { role: 'ORDENADOR', homeStation: 0, shortDay: '' };
      return next;
    });
  }

  function updateWorker(id: string, patch: Partial<WorkerSetup>) {
    clearResult();
    setSetupById((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function changeStationsCount(value: number) {
    const count = Math.min(10, Math.max(1, value || 1));
    clearResult();
    setStationsCount(count);
    setSetupById((prev) =>
      Object.fromEntries(Object.entries(prev).map(([id, s]) => [id, { ...s, homeStation: Math.min(s.homeStation, count - 1) }])),
    );
  }

  // Resumen del equipo por ordeño, para ver de un vistazo si esta completo.
  const teamSummary = useMemo(() => {
    const stations = Array.from({ length: stationsCount }, () => ({ ordenadores: 0, vaqueros: 0 }));
    let comodines = 0;
    for (const setup of Object.values(setupById)) {
      if (setup.role === 'COMODIN') comodines++;
      else if (setup.role === 'VAQUERO') stations[Math.min(setup.homeStation, stationsCount - 1)].vaqueros++;
      else stations[Math.min(setup.homeStation, stationsCount - 1)].ordenadores++;
    }
    return { stations, comodines };
  }, [setupById, stationsCount]);

  async function run(preview: boolean) {
    setBusy(preview ? 'preview' : 'save');
    setError(null);
    setSavedNotice(null);
    try {
      const plan = await milkingRoster(companyId, {
        name,
        stationsCount,
        morningStart,
        morningEnd,
        eveningStart,
        eveningEnd,
        preview,
        workers: selected.map((e) => {
          const setup = setupById[e.id];
          return {
            userId: e.id,
            role: setup.role,
            homeStation: setup.role === 'COMODIN' ? undefined : setup.homeStation,
            shortDayOffset: setup.shortDay === '' ? undefined : Number(setup.shortDay),
          };
        }),
      });
      if (plan.saved) {
        await reloadRoutines(companyId);
        setResult(null);
        setSavedNotice(`La rutina "${name}" quedó guardada. Todavía no rige: para que sea el horario de esas personas, habilítala en la lista de arriba.`);
      } else {
        setResult(plan);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const canRun = Boolean(companyId && name.trim() && selected.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rutina de Ordeño"
        subtitle="Aquí están las rutinas guardadas. La que habilites pasa a ser el horario de las personas de esa rutina."
      />

      {routinesLoaded && routines.length === 0 && (
        <Card className="p-6 text-sm text-ink-secondary">
          Todavía no hay rutinas guardadas. Arma una más abajo, mírala, guárdala y después habilítala.
        </Card>
      )}

      {routines.map((routine) => (
        <RoutineCard key={routine.id} routine={routine} routines={routines} companyId={companyId} onChanged={() => reloadRoutines(companyId)} />
      ))}

      <Card className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Milk size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">Armar una rutina nueva</div>
            <div className="text-xs text-ink-muted">
              Cada ordeño necesita cada día 2 ordeñadores de jornada completa y 1 vaquero. Todos tienen el mismo ciclo de 14 días:
              una semana con media jornada (4 h) y un descanso, y la siguiente con dos descansos. Eso da 44 h una semana y 40 h la
              otra (84 h en las dos semanas, 42 en promedio), así que no genera horas extra. Guardar una rutina no cambia el horario
              de nadie; eso pasa solo cuando la habilitas.
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="routine-name">
              Nombre de la rutina
            </label>
            <input
              id="routine-name"
              placeholder="ej. Ordeño Finca Principal"
              value={name}
              onChange={(e) => {
                setSavedNotice(null);
                setName(e.target.value);
              }}
              className={`mt-1 w-full ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="stations-count">
              Cantidad de ordeños
            </label>
            <input
              id="stations-count"
              type="number"
              min={1}
              max={10}
              value={stationsCount}
              onChange={(e) => changeStationsCount(Number(e.target.value))}
              className={`mt-1 w-full ${inputClass}`}
            />
          </div>
        </div>

        <div className="mt-5">
          <div className={labelClass}>Personas de la rutina ({selected.length} seleccionadas)</div>
          <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-line-axis bg-surface-card p-2">
            {employees.length === 0 && <p className="p-2 text-sm text-ink-muted">No hay empleados activos. Créalos primero en Empleados.</p>}
            {employees.map((emp) => (
              <label key={emp.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-secondary hover:bg-surface-page">
                <input type="checkbox" checked={Boolean(setupById[emp.id])} onChange={() => toggleWorker(emp.id)} />
                {emp.fullName} <span className="text-xs text-ink-muted">({emp.employeeCode})</span>
              </label>
            ))}
          </div>
        </div>

        {selected.length > 0 && (
          <div className="mt-5">
            <div className={labelClass}>Puesto de cada persona</div>
            <div className="mt-1 overflow-x-auto rounded-lg border border-line-hair">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-page text-left text-xs font-semibold text-ink-secondary">
                  <tr>
                    <th className="px-3 py-2">Persona</th>
                    <th className="px-3 py-2">Puesto</th>
                    <th className="px-3 py-2">Ordeño base</th>
                    <th className="px-3 py-2">Día de media jornada (semana A)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-hair">
                  {selected.map((emp) => {
                    const setup = setupById[emp.id];
                    return (
                      <tr key={emp.id}>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">{emp.fullName}</td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Puesto de ${emp.fullName}`}
                            value={setup.role}
                            onChange={(e) => updateWorker(emp.id, { role: e.target.value as MilkingRosterRole })}
                            className={inputClass}
                          >
                            {ROLE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          {setup.role === 'COMODIN' ? (
                            <span className="text-xs text-ink-muted">Donde haga falta</span>
                          ) : (
                            <select
                              aria-label={`Ordeño base de ${emp.fullName}`}
                              value={setup.homeStation}
                              onChange={(e) => updateWorker(emp.id, { homeStation: Number(e.target.value) })}
                              className={inputClass}
                            >
                              {Array.from({ length: stationsCount }, (_, s) => (
                                <option key={s} value={s}>
                                  {setup.role === 'VAQUERO' ? `Vaquería ${s + 1}` : `Ordeño ${s + 1}`}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Día de media jornada de ${emp.fullName}`}
                            value={setup.shortDay}
                            onChange={(e) => updateWorker(emp.id, { shortDay: e.target.value })}
                            className={inputClass}
                          >
                            <option value="">Que lo escoja el sistema</option>
                            {Array.from({ length: 7 }, (_, d) => (
                              <option key={d} value={d}>
                                {cycleWeekday(d)} (descansa el día siguiente)
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
              {ROLE_OPTIONS.map((option) => (
                <li key={option.value}>
                  <span className="font-medium text-ink-secondary">{option.label}:</span> {option.help}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {teamSummary.stations.map((station, s) => {
                const complete = station.ordenadores >= 2 && station.vaqueros >= 1;
                return (
                  <span
                    key={s}
                    className={`rounded-full px-3 py-1 font-medium ${complete ? 'bg-surface-page text-ink-secondary' : 'bg-amber-50 text-amber-800'}`}
                  >
                    Ordeño {s + 1}: {station.ordenadores} ordeñador(es), {station.vaqueros} vaquero(s)
                    {!complete && ' — incompleto'}
                  </span>
                );
              })}
              <span className="rounded-full bg-surface-page px-3 py-1 font-medium text-ink-secondary">Comodines: {teamSummary.comodines}</span>
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className={labelClass} htmlFor="morning-start">
              Ordeño mañana desde
            </label>
            <input id="morning-start" type="time" value={morningStart} onChange={(e) => setMorningStart(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass} htmlFor="morning-end">
              Ordeño mañana hasta
            </label>
            <input id="morning-end" type="time" value={morningEnd} onChange={(e) => setMorningEnd(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass} htmlFor="evening-start">
              Ordeño tarde desde
            </label>
            <input id="evening-start" type="time" value={eveningStart} onChange={(e) => setEveningStart(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass} htmlFor="evening-end">
              Ordeño tarde hasta
            </label>
            <input id="evening-end" type="time" value={eveningEnd} onChange={(e) => setEveningEnd(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        {savedNotice && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
            {savedNotice}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={!canRun || busy !== null} onClick={() => run(true)}>
            <Eye size={16} />
            {busy === 'preview' ? 'Calculando...' : 'Ver cómo queda'}
          </Button>
          <Button disabled={!canRun || busy !== null || !result?.feasible} onClick={() => run(false)}>
            <Save size={16} />
            {busy === 'save' ? 'Guardando...' : 'Guardar rutina'}
          </Button>
          <span className="text-xs text-ink-muted">
            {!canRun
              ? 'Pon el nombre y escoge las personas.'
              : !result
                ? 'Primero mira cómo queda.'
                : !result.feasible
                  ? 'No se puede guardar mientras haya días sin cubrir.'
                  : 'Si te gusta cómo quedó, guárdala. Guardar no cambia el horario de nadie.'}
          </span>
        </div>
      </Card>

      {result && (
        <Card className={`p-6 ${WIDE_CARD}`}>
          <div className="mb-3 text-sm font-semibold text-ink">Así quedaría: {name}</div>
          <RosterStatus view={result} />
          <RosterSheet view={result} />
          {result.workers.some((w) => w.chosenBySystem) && (
            <p className="mt-3 text-xs text-ink-muted">
              Media jornada que escogió el sistema:{' '}
              {result.workers
                .filter((w) => w.chosenBySystem)
                .map((w) => `${w.fullName} (${cycleWeekday(w.shortDayOffset).toLowerCase()}${w.shortDayOffset > 6 ? ' de la semana B' : ''})`)
                .join(', ')}
              .
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<MilkingRoutine['status'], { label: string; className: string }> = {
  VIGENTE: { label: 'Vigente', className: 'bg-emerald-100 text-emerald-900' },
  GUARDADA: { label: 'Guardada, no rige', className: 'bg-surface-page text-ink-secondary ring-1 ring-inset ring-line-axis' },
  INACTIVA: { label: 'Inactiva', className: 'bg-surface-page text-ink-muted ring-1 ring-inset ring-line-hair' },
};

/** Una rutina guardada: su estado, su planilla y los botones para habilitarla o borrarla. */
function RoutineCard({
  routine,
  routines,
  companyId,
  onChanged,
}: {
  routine: MilkingRoutine;
  routines: MilkingRoutine[];
  companyId: string;
  onChanged: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(routine.status === 'VIGENTE');
  const [panel, setPanel] = useState<'enable' | 'delete' | null>(null);
  const [startDate, setStartDate] = useState(nextMonday);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const status = STATUS_STYLES[routine.status];
  const startIsMonday = Boolean(startDate) && parseDay(startDate).getDay() === 1;
  const workerIds = useMemo(() => new Set(routine.workers.map((w) => w.userId)), [routine.workers]);

  // Rutinas vigentes que comparten gente con esta: dejan de regir al habilitarla.
  const replaced = useMemo(
    () =>
      routines
        .filter((other) => other.id !== routine.id && other.status === 'VIGENTE' && other.workers.some((w) => workerIds.has(w.userId)))
        .map((other) => ({ name: other.name, left: other.workers.filter((w) => !workerIds.has(w.userId)).map((w) => w.fullName) })),
    [routines, routine.id, workerIds],
  );

  const when =
    routine.status === 'VIGENTE' && routine.anchorDate
      ? `Rige desde el ${longDate(routine.anchorDate)}`
      : routine.status === 'INACTIVA' && routine.anchorDate && routine.validTo
        ? `Rigió del ${shortDate(routine.anchorDate)} al ${shortDate(routine.validTo)}`
        : `Guardada el ${shortDate(toKey(new Date(routine.createdAt)))}`;

  async function enable() {
    setWorking(true);
    setError(null);
    try {
      const done = await enableMilkingRoutine(companyId, routine.id, startDate);
      setPanel(null);
      setOpen(true);
      setNotice(`Habilitada desde el ${longDate(done.startDate)}. Se generaron ${done.shiftsGenerated} turnos.`);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    setWorking(true);
    setError(null);
    try {
      await deleteMilkingRoutine(companyId, routine.id);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
      setWorking(false);
    }
  }

  return (
    <Card className={`p-6 ${WIDE_CARD}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-ink">{routine.name}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            {when} · {routine.workers.length} persona(s) · {routine.stationsCount} ordeño(s) · ordeños de {routine.morningStart} a {routine.morningEnd} y
            de {routine.eveningStart} a {routine.eveningEnd}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {open ? 'Ocultar planilla' : 'Ver planilla'}
          </Button>
          {routine.status !== 'VIGENTE' && (
            <Button disabled={routine.unavailableWorkers.length > 0 || !routine.feasible} onClick={() => setPanel(panel === 'enable' ? null : 'enable')}>
              <Power size={16} />
              Habilitar
            </Button>
          )}
          {routine.status === 'GUARDADA' && (
            <Button variant="danger" onClick={() => setPanel(panel === 'delete' ? null : 'delete')}>
              <Trash2 size={16} />
              Borrar
            </Button>
          )}
        </div>
      </div>

      {routine.unavailableWorkers.length > 0 && routine.status !== 'VIGENTE' && (
        <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          No se puede habilitar: {routine.unavailableWorkers.join(', ')} ya no está(n) activo(s) en la empresa. Arma una rutina nueva con el equipo actual.
        </p>
      )}

      {notice && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
          {notice}
        </p>
      )}

      {panel === 'enable' && (
        <div className="mt-4 rounded-lg border border-line-axis bg-surface-page p-4 text-sm text-ink">
          <div className="font-semibold">Habilitar “{routine.name}”</div>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div>
              <label className={labelClass} htmlFor={`start-${routine.id}`}>
                Empieza a regir el lunes
              </label>
              <input
                id={`start-${routine.id}`}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </div>
            {startDate && !startIsMonday && <p className="pb-2 text-xs text-red-700">Ese día no es lunes. La semana A siempre empieza un lunes.</p>}
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-ink-secondary">
            <li>
              Desde ese día esta rutina es el horario de sus {routine.workers.length} persona(s) y reemplaza el horario que tengan ahora.
            </li>
            {replaced.map((other) => (
              <li key={other.name}>
                La rutina <span className="font-medium text-ink">{other.name}</span> deja de regir el día anterior.
                {other.left.length > 0 && (
                  <span className="text-amber-800">
                    {' '}
                    Quedan sin rutina y hay que asignarles horario: {other.left.join(', ')}.
                  </span>
                )}
              </li>
            ))}
          </ul>
          {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button disabled={working || !startIsMonday} onClick={enable}>
              {working ? 'Habilitando...' : 'Sí, habilitar'}
            </Button>
            <Button variant="secondary" disabled={working} onClick={() => setPanel(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {panel === 'delete' && (
        <div className="mt-4 rounded-lg border border-line-axis bg-surface-page p-4 text-sm text-ink">
          <p>¿Borrar la rutina guardada “{routine.name}”? Nunca ha regido, así que no cambia el horario de nadie.</p>
          {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button variant="danger" disabled={working} onClick={remove}>
              {working ? 'Borrando...' : 'Sí, borrar'}
            </Button>
            <Button variant="secondary" disabled={working} onClick={() => setPanel(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {open && (
        <>
          {!routine.feasible && <RosterStatus view={routine} />}
          <RosterSheet view={routine} />
        </>
      )}
    </Card>
  );
}

/** Aviso de si la rutina cubre todos los puestos o cuales quedan sin cubrir. */
function RosterStatus({ view }: { view: MilkingRosterView }) {
  return (
    <>
      {view.feasible ? (
        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
          <div>
            <div className="font-semibold">Todos los puestos quedan cubiertos los 14 días</div>
            {view.vaqueriaCoversByOrdenadores > 0 && (
              <p className="mt-0.5">
                Ojo: {view.vaqueriaCoversByOrdenadores} vez/veces un ordeñador tiene que cubrir una vaquería porque no hay comodín libre ese día.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Con este equipo quedan puestos sin cubrir</div>
            <ul className="mt-1 list-disc pl-5">
              {view.gaps.map((gap, i) => (
                <li key={i}>
                  {cycleWeekday(gap.dayOffset)} de la semana {gap.dayOffset < 7 ? 'A' : 'B'}:{' '}
                  {gap.post === 'VAQUERIA'
                    ? `la Vaquería ${gap.station + 1} queda sin vaquero`
                    : `al Ordeño ${gap.station + 1} le falta(n) ${gap.missing} ordeñador(es)`}
                  .
                </li>
              ))}
            </ul>
            <p className="mt-1">Agrega una persona, cambia algún día de media jornada o deja que el sistema escoja los días.</p>
          </div>
        </div>
      )}
      {view.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">
          {view.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** La planilla de las dos semanas, con el mismo aspecto de la hoja de la finca: Semana A y Semana B lado a lado. */
function RosterSheet({ view }: { view: MilkingRosterView }) {
  const workers = sheetOrder(view.workers);
  const weeks = [0, 1].map((week) => view.days.slice(week * 7, week * 7 + 7));
  const cellOf = (dayOffset: number, userId: string) => view.days[dayOffset].cells.find((c) => c.userId === userId)!;
  const headClass = 'border border-neutral-500 bg-white px-0.5 py-2 text-center font-bold uppercase';
  const cellClass = 'border border-neutral-500 px-0.5 py-2 text-center';

  // Con fecha de inicio: las fechas del ciclo de 14 dias en el que cae hoy (o el primero, si aun no empieza).
  const todayKey = toKey(new Date());
  let cycleStart: string | null = null;
  if (view.anchorDate) {
    const daysSince = Math.round((parseDay(todayKey).getTime() - parseDay(view.anchorDate).getTime()) / 86_400_000);
    cycleStart = addDays(view.anchorDate, Math.max(0, Math.floor(daysSince / 14)) * 14);
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-6 min-[1500px]:grid-cols-2">
      {weeks.map((days, week) => {
        const hours = workers.map((w) => days.reduce((sum, day) => sum + cellHours(cellOf(day.dayOffset, w.userId)), 0));
        const sameHours = hours.every((h) => h === hours[0]);
        const weekStart = cycleStart ? addDays(cycleStart, week * 7) : null;
        const isThisWeek = weekStart !== null && todayKey >= weekStart && todayKey <= addDays(weekStart, 6);
        return (
          <div key={week}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] table-fixed border-collapse border-2 border-neutral-900 text-[10px] leading-tight tracking-tight text-neutral-900 tabular-nums min-[1700px]:text-[11px] min-[1700px]:tracking-normal">
                <colgroup>
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '15%' }} />
                  {days.map((day) => (
                    <col key={day.dayOffset} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b-2 border-neutral-900">
                    <th className={headClass}>Ubicación</th>
                    <th className={headClass}>Nombre</th>
                    {days.map((day) => (
                      <th key={day.dayOffset} className={headClass}>
                        {cycleWeekday(day.dayOffset)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workers.map((worker) => (
                    <tr key={worker.userId}>
                      <td className="border border-neutral-500 bg-white px-1.5 py-1.5 text-left font-bold">{locationLabel(worker, view.stationsCount)}</td>
                      <td className={`${cellClass} bg-white uppercase`}>{worker.fullName}</td>
                      {days.map((day) => {
                        const cell = cellOf(day.dayOffset, worker.userId);
                        const resting = cell.kind === 'DESCANSO' || cell.station === null;
                        const background = resting
                          ? '#ffffff'
                          : cell.kind === 'CORTO'
                            ? SHORT_DAY_COLOR
                            : STATION_COLORS[(cell.station ?? 0) % STATION_COLORS.length];
                        return (
                          <td
                            key={day.dayOffset}
                            className={`${cellClass} whitespace-nowrap ${resting || cell.kind === 'CORTO' ? 'font-bold' : 'font-medium'}`}
                            style={{ backgroundColor: background }}
                          >
                            {sheetCellText(worker, cell, view.stationsCount)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-center text-base font-medium tracking-wide text-ink">SEMANA {week === 0 ? 'A' : 'B'}</div>
            <div className="text-center text-xs text-ink-muted">
              {weekStart && `${shortDate(weekStart)} al ${shortDate(addDays(weekStart, 6))}`}
              {isThisWeek && <span className="font-semibold text-emerald-700"> · esta semana</span>}
              {weekStart && sameHours && ' · '}
              {sameHours && `${hours[0]} h por persona`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
