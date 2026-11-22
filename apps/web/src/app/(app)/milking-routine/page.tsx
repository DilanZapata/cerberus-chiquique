'use client';

import { useEffect, useMemo, useState } from 'react';
import { Milk, AlertTriangle, CheckCircle2, Eye, Sparkles } from 'lucide-react';
import {
  Employee,
  MilkingRosterCell,
  MilkingRosterResult,
  MilkingRosterRole,
  getCurrentMilkingRosters,
  getEmployees,
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
  /** '' = que lo escoja el sistema; si no, dia 0..6 de la primera semana. */
  shortDay: string;
}

function dateAt(anchorDate: string, dayOffset: number): Date | null {
  if (!anchorDate) return null;
  const d = new Date(`${anchorDate}T00:00:00`);
  d.setDate(d.getDate() + dayOffset);
  return d;
}

function weekdayAt(anchorDate: string, dayOffset: number): string {
  const d = dateAt(anchorDate, dayOffset);
  return d ? WEEKDAY_LABELS[d.getDay()] : `Día ${dayOffset + 1}`;
}

function shortDateAt(anchorDate: string, dayOffset: number): string {
  const d = dateAt(anchorDate, dayOffset);
  return d ? `${d.getDate()} ${MONTH_LABELS[d.getMonth()]}` : '';
}

function cellHours(cell: MilkingRosterCell): number {
  return cell.kind === 'COMPLETO' ? 8 : cell.kind === 'CORTO' ? 4 : 0;
}

type RosterWorker = MilkingRosterResult['workers'][number];

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
  const [name, setName] = useState('');
  const [stationsCount, setStationsCount] = useState(2);
  const [setupById, setSetupById] = useState<Record<string, WorkerSetup>>({});
  const [anchorDate, setAnchorDate] = useState('');
  const [morningStart, setMorningStart] = useState('04:00');
  const [morningEnd, setMorningEnd] = useState('08:00');
  const [eveningStart, setEveningStart] = useState('16:00');
  const [eveningEnd, setEveningEnd] = useState('20:00');
  const [busy, setBusy] = useState<'preview' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MilkingRosterResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [current, setCurrent] = useState<Array<MilkingRosterResult & { name: string }>>([]);

  useEffect(() => {
    const id = getCompanyId();
    if (id) {
      setCompanyId(id);
      getCurrentMilkingRosters(id)
        .then(setCurrent)
        .catch(() => {});
    }
    getEmployees()
      .then(setEmployees)
      .catch(() => {});
  }, []);

  const selected = useMemo(() => employees.filter((e) => setupById[e.id]), [employees, setupById]);
  const anchorIsMonday = !anchorDate || dateAt(anchorDate, 0)?.getDay() === 1;

  function toggleWorker(id: string) {
    setResult(null);
    setSetupById((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = { role: 'ORDENADOR', homeStation: 0, shortDay: '' };
      return next;
    });
  }

  function updateWorker(id: string, patch: Partial<WorkerSetup>) {
    setResult(null);
    setSetupById((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function changeStationsCount(value: number) {
    const count = Math.min(10, Math.max(1, value || 1));
    setResult(null);
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
    setConfirming(false);
    setBusy(preview ? 'preview' : 'create');
    setError(null);
    try {
      const plan = await milkingRoster(companyId, {
        name,
        stationsCount,
        anchorDate,
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
      setResult(plan);
      if (plan.created) {
        getCurrentMilkingRosters(companyId)
          .then(setCurrent)
          .catch(() => {});
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const canRun = Boolean(companyId && name.trim() && anchorDate && selected.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rutina de Ordeño"
        subtitle="Arma la rutina de las dos semanas según el puesto de cada persona y avisa si algún día queda sin cubrir."
      />

      {current.map((roster) => (
        <Card key={`${roster.name}-${roster.anchorDate}`} className={`p-6 ${WIDE_CARD}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold text-ink">Rutina en curso: {roster.name}</div>
            <div className="text-xs text-ink-muted">
              La semana A empezó el {weekdayAt(roster.anchorDate, 0).toLowerCase()} {shortDateAt(roster.anchorDate, 0)} y se repite cada 14 días.
            </div>
          </div>
          <RosterSheet result={roster} />
        </Card>
      ))}

      <Card className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Milk size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">{current.length > 0 ? 'Armar una rutina nueva' : 'Cómo funciona'}</div>
            <div className="text-xs text-ink-muted">
              Cada ordeño necesita cada día 2 ordeñadores de jornada completa y 1 vaquero. Todos tienen el mismo ciclo de 14 días:
              una semana con media jornada (4 h) y un descanso, y la siguiente con dos descansos. Eso da 44 h una semana y 40 h la
              otra (84 h en las dos semanas, 42 en promedio), así que no genera horas extra.
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className={labelClass} htmlFor="routine-name">
              Nombre de la rutina
            </label>
            <input
              id="routine-name"
              placeholder="ej. Ordeño Finca Principal"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="anchor-date">
              Primer día de la semana A
            </label>
            <input
              id="anchor-date"
              type="date"
              value={anchorDate}
              onChange={(e) => {
                setResult(null);
                setAnchorDate(e.target.value);
              }}
              className={`mt-1 w-full ${inputClass}`}
            />
            {!anchorIsMonday && (
              <p className="mt-1 text-xs text-amber-700">
                Esa fecha no es lunes. Funciona igual, pero las semanas A y B quedan corridas respecto al calendario; lo normal es
                empezar un lunes.
              </p>
            )}
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
                                {weekdayAt(anchorDate, d)} (descansa el día siguiente)
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

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={!canRun || busy !== null} onClick={() => run(true)}>
            <Eye size={16} />
            {busy === 'preview' ? 'Calculando...' : 'Ver cómo queda'}
          </Button>
          <Button disabled={!canRun || busy !== null || !result?.feasible || result.created || confirming} onClick={() => setConfirming(true)}>
            <Sparkles size={16} />
            {busy === 'create' ? 'Creando la rutina...' : 'Crear rutina y generar turnos'}
          </Button>
          <span className="text-xs text-ink-muted">
            {!canRun
              ? 'Pon el nombre, la fecha de inicio y escoge las personas.'
              : !result
                ? 'Primero mira cómo queda; ver no cambia nada.'
                : !result.feasible
                  ? 'No se puede crear mientras haya días sin cubrir.'
                  : result.created
                    ? 'La rutina ya quedó creada.'
                    : 'Si te gusta cómo quedó, créala.'}
          </span>
        </div>

        {confirming && result?.feasible && !result.created && (
          <div className="mt-3 rounded-lg border border-line-axis bg-surface-page p-3 text-sm text-ink">
            <p>
              Se va a crear la rutina <span className="font-semibold">{name}</span> para {selected.length} persona(s) desde el{' '}
              {weekdayAt(anchorDate, 0).toLowerCase()} {shortDateAt(anchorDate, 0)}. Desde ese día reemplaza el horario que tengan ahora.
            </p>
            <div className="mt-2 flex gap-2">
              <Button onClick={() => run(false)}>Sí, crear la rutina</Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

      </Card>

      {result && (
        <Card className={`p-6 ${WIDE_CARD}`}>
          <RosterResult result={result} name={name} />
        </Card>
      )}
    </div>
  );
}

function RosterResult({ result, name }: { result: MilkingRosterResult; name: string }) {
  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-ink">
        {result.created ? 'Rutina creada' : 'Así quedaría'}: {name}
      </div>
      {result.feasible ? (
        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
          <div>
            <div className="font-semibold">
              {result.created ? 'Rutina creada: todos los puestos cubiertos los 14 días' : 'Todos los puestos quedan cubiertos los 14 días'}
            </div>
            {result.created && (
              <p className="mt-0.5">
                Se generaron {result.shiftsGenerated} turnos. La rutina se repite sola cada 14 días y cada turno lleva el puesto de ese día.
              </p>
            )}
            {result.vaqueriaCoversByOrdenadores > 0 && (
              <p className="mt-0.5">
                Ojo: {result.vaqueriaCoversByOrdenadores} vez/veces un ordeñador tiene que cubrir una vaquería porque no hay comodín libre ese día.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Con este equipo quedan puestos sin cubrir. No se creó nada.</div>
            <ul className="mt-1 list-disc pl-5">
              {result.gaps.map((gap, i) => (
                <li key={i}>
                  {weekdayAt(result.anchorDate, gap.dayOffset)} {shortDateAt(result.anchorDate, gap.dayOffset)} (semana {gap.dayOffset < 7 ? 'A' : 'B'}):{' '}
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

      {result.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <RosterSheet result={result} />

      {result.workers.some((w) => w.chosenBySystem) && (
        <p className="mt-3 text-xs text-ink-muted">
          Media jornada que escogió el sistema:{' '}
          {result.workers
            .filter((w) => w.chosenBySystem)
            .map((w) => `${w.fullName} (${weekdayAt(result.anchorDate, w.shortDayOffset).toLowerCase()}${w.shortDayOffset > 6 ? ' de la semana B' : ''})`)
            .join(', ')}
          .
        </p>
      )}
    </div>
  );
}

/** La planilla de las dos semanas, con el mismo aspecto de la hoja de la finca: Semana A y Semana B lado a lado. */
function RosterSheet({ result }: { result: MilkingRosterResult }) {
  const workers = sheetOrder(result.workers);
  const weeks = [0, 1].map((week) => result.days.slice(week * 7, week * 7 + 7));
  const cellOf = (dayOffset: number, userId: string) => result.days[dayOffset].cells.find((c) => c.userId === userId)!;
  const headClass = 'border border-neutral-500 bg-white px-0.5 py-2 text-center font-bold uppercase';
  const cellClass = 'border border-neutral-500 px-0.5 py-2 text-center';

  return (
    <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-6 min-[1500px]:grid-cols-2">
      {weeks.map((days, week) => {
        const hours = workers.map((w) => days.reduce((sum, day) => sum + cellHours(cellOf(day.dayOffset, w.userId)), 0));
        const sameHours = hours.every((h) => h === hours[0]);
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
                      <th key={day.dayOffset} className={headClass} title={shortDateAt(result.anchorDate, day.dayOffset)}>
                        {weekdayAt(result.anchorDate, day.dayOffset)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workers.map((worker) => (
                    <tr key={worker.userId}>
                      <td className="border border-neutral-500 bg-white px-1.5 py-1.5 text-left font-bold">
                        {locationLabel(worker, result.stationsCount)}
                      </td>
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
                            {sheetCellText(worker, cell, result.stationsCount)}
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
              {shortDateAt(result.anchorDate, week * 7)} al {shortDateAt(result.anchorDate, week * 7 + 6)}
              {sameHours && ` · ${hours[0]} h por persona`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
