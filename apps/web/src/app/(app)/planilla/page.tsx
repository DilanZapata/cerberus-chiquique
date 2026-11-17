'use client';

import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { Download, Pencil, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  AttendanceGrid,
  AttendanceGridDay,
  downloadAttendanceGrid,
  Employee,
  getAttendanceGrid,
  getEmployees,
  GRID_CONCEPTS,
  GridConcept,
} from '@/lib/api';

const inputClass =
  'mt-1 w-full rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

/** Formas de armar el periodo. "cut26" es el corte de la planilla manual: del 26 del mes anterior al 25. */
type PeriodPreset = 'cut26' | 'month' | 'q1' | 'q2' | 'custom';

const PRESET_LABELS: Record<PeriodPreset, string> = {
  cut26: 'Corte del 26 al 25',
  month: 'Mes calendario (1 a fin de mes)',
  q1: 'Primera quincena (1 al 15)',
  q2: 'Segunda quincena (16 a fin de mes)',
  custom: 'Rango personalizado',
};

const PRESET_STORAGE_KEY = 'cerberus.planilla.preset';
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
// Hora en que EMPIEZA cada columna ("12" = de 12 a 1, "1" = de 1 a 2...), bajo su grupo a. m. / p. m.
const HOUR_LABELS = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

const CONCEPT_INFO: Record<GridConcept, { label: string; title: string }> = {
  HEOD: { label: 'HEOD', title: 'Hora extra ordinaria diurna' },
  HEON: { label: 'HEON', title: 'Hora extra ordinaria nocturna' },
  HEFD: { label: 'HEFD', title: 'Hora extra festiva/dominical diurna' },
  HEFN: { label: 'HEFN', title: 'Hora extra festiva/dominical nocturna' },
  RNO: { label: 'RNO', title: 'Recargo nocturno ordinario' },
  DDCOF: { label: 'DDCoF', title: 'Dominical/festivo ordinario diurno' },
  DNCOF: { label: 'DNCoF', title: 'Dominical/festivo ordinario nocturno' },
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(year: number, monthIndex: number, day: number): string {
  const d = new Date(year, monthIndex, day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Rango de fechas de un preset para el mes "YYYY-MM". */
function rangeFor(preset: Exclude<PeriodPreset, 'custom'>, month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const monthIndex = m - 1;
  if (preset === 'cut26') return { from: iso(y, monthIndex - 1, 26), to: iso(y, monthIndex, 25) };
  if (preset === 'q1') return { from: iso(y, monthIndex, 1), to: iso(y, monthIndex, 15) };
  if (preset === 'q2') return { from: iso(y, monthIndex, 16), to: iso(y, monthIndex + 1, 0) };
  return { from: iso(y, monthIndex, 1), to: iso(y, monthIndex + 1, 0) };
}

/** Mes cuyo periodo contiene el dia de hoy (con el corte 26-25, del 26 en adelante ya es el periodo del mes siguiente). */
function currentMonthFor(preset: PeriodPreset): string {
  const now = new Date();
  const shift = preset === 'cut26' && now.getDate() >= 26 ? 1 : 0;
  const d = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}

function timeOf(isoString: string | null, rowDate: string): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  const sameDay = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === rowDate;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${sameDay ? '' : ' (+1)'}`;
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'critical' }) {
  return (
    <div className="rounded-lg border border-line-hair bg-surface-card px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div
        className={clsx(
          'mt-0.5 text-lg font-semibold tabular-nums',
          tone === 'warning' ? 'text-amber-700' : tone === 'critical' ? 'text-red-700' : 'text-ink',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function HourCell({ value }: { value: number }) {
  if (value <= 0) return <td className="border-l border-line-hair p-0" />;
  const full = value >= 1;
  return (
    <td className="border-l border-line-hair p-0" title={`${fmt(value)} h`}>
      <div
        className={clsx(
          'mx-auto flex h-6 items-center justify-center text-[9px] font-semibold tabular-nums',
          full ? 'bg-emerald-600 text-white' : 'bg-emerald-200 text-emerald-900',
        )}
      >
        {full ? '' : fmt(value).replace(/^0/, '')}
      </div>
    </td>
  );
}

function ConceptCell({ day, concept }: { day: AttendanceGridDay; concept: GridConcept }) {
  const c = day.concepts[concept];
  if (c.payable <= 0 && c.pending <= 0 && c.rejected <= 0) return <td className="border-l border-line-hair px-1.5 py-1" />;
  return (
    <td className="border-l border-line-hair px-1.5 py-1 text-center tabular-nums">
      {c.payable > 0 && <div className="font-semibold text-ink">{fmt(c.payable)}</div>}
      {c.pending > 0 && (
        <div className="text-[10px] font-medium text-amber-700" title="Horas extra pendientes de aprobar">
          {fmt(c.pending)} pend.
        </div>
      )}
      {c.rejected > 0 && (
        <div className="text-[10px] font-medium text-red-700 line-through" title="Horas extra rechazadas (no se pagan)">
          {fmt(c.rejected)}
        </div>
      )}
    </td>
  );
}

export default function PlanillaPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Cargando...</p>}>
      <PlanillaInner />
    </Suspense>
  );
}

function PlanillaInner() {
  const searchParams = useSearchParams();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [preset, setPreset] = useState<PeriodPreset>('cut26');
  const [month, setMonth] = useState(() => currentMonthFor('cut26'));
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [grid, setGrid] = useState<AttendanceGrid | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<'one' | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // La forma de corte que la persona eligio se recuerda en este navegador.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PRESET_STORAGE_KEY) as PeriodPreset | null;
      if (saved && saved in PRESET_LABELS && saved !== 'custom') {
        setPreset(saved);
        setMonth(currentMonthFor(saved));
      }
    } catch {
      // Sin almacenamiento local (modo privado): se queda el corte por defecto.
    }
  }, []);

  useEffect(() => {
    getEmployees()
      .then((list) => {
        const sorted = [...list].sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
        setEmployees(sorted);
        const requested = searchParams.get('employeeId');
        // Por defecto, la primera persona que si marca asistencia (no el usuario administrador).
        const initial = sorted.find((e) => e.id === requested) ?? sorted.find((e) => e.role === 'EMPLOYEE') ?? sorted[0];
        if (initial) setEmployeeId(initial.id);
      })
      .catch((err) => setError((err as Error).message));
  }, [searchParams]);

  const range = useMemo(() => {
    if (preset === 'custom') return customFrom && customTo ? { from: customFrom, to: customTo } : null;
    return month ? rangeFor(preset, month) : null;
  }, [preset, month, customFrom, customTo]);

  useEffect(() => {
    if (!employeeId || !range) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAttendanceGrid(employeeId, range.from, range.to)
      .then((g) => !cancelled && setGrid(g))
      .catch((err) => {
        if (cancelled) return;
        setGrid(null);
        setError((err as Error).message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [employeeId, range]);

  function choosePreset(next: PeriodPreset) {
    if (next === 'custom' && range) {
      setCustomFrom(range.from);
      setCustomTo(range.to);
    }
    if (next !== 'custom') {
      setMonth(currentMonthFor(next));
      try {
        window.localStorage.setItem(PRESET_STORAGE_KEY, next);
      } catch {
        // No se pudo recordar la eleccion; no afecta la consulta actual.
      }
    }
    setPreset(next);
  }

  async function download(scope: 'one' | 'all') {
    if (!range) return;
    setDownloading(scope);
    setError(null);
    try {
      if (scope === 'one') {
        const employee = employees.find((e) => e.id === employeeId);
        await downloadAttendanceGrid(range.from, range.to, employeeId, employee?.employeeCode);
      } else {
        await downloadAttendanceGrid(range.from, range.to);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  const totals = grid?.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planilla por Persona"
        subtitle="Las entradas y salidas de cada persona, dia por dia y hora por hora, con sus novedades de nomina (horas extra, recargos, dominicales y festivos). Es la misma planilla que se llevaba en Excel, armada sola a partir de las marcas."
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="block text-sm font-medium text-ink-secondary">Empleado</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName} — {e.nationalId}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[210px]">
            <label className="block text-sm font-medium text-ink-secondary">Periodo</label>
            <select value={preset} onChange={(e) => choosePreset(e.target.value as PeriodPreset)} className={inputClass}>
              {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          {preset === 'custom' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-ink-secondary">Desde</label>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-secondary">Hasta</label>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={inputClass} />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-ink-secondary">Mes</label>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="success" disabled={!grid || downloading !== null} onClick={() => download('one')}>
            <Download size={16} />
            {downloading === 'one' ? 'Generando...' : 'Excel de esta persona'}
          </Button>
          <Button variant="secondary" disabled={!range || downloading !== null} onClick={() => download('all')}>
            <Users size={16} />
            {downloading === 'all' ? 'Generando...' : 'Excel de todos los empleados'}
          </Button>
          {employeeId && range && (
            <Link href={`/payroll-manual?employeeId=${employeeId}&from=${range.from}&to=${range.to}`}>
              <Button variant="ghost">
                <Pencil size={16} />
                Corregir marcas y novedades
              </Button>
            </Link>
          )}
          {range && (
            <span className="ml-auto text-sm text-ink-secondary">
              Del <span className="font-medium text-ink">{range.from}</span> al{' '}
              <span className="font-medium text-ink">{range.to}</span>
            </span>
          )}
        </div>
      </Card>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {totals && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <StatTile label="Horas trabajadas" value={fmt(totals.workedHours)} />
          <StatTile label="Dias trabajados" value={String(totals.daysWorked)} />
          <StatTile
            label="Horas extra a pagar"
            value={fmt(
              totals.concepts.HEOD.payable + totals.concepts.HEON.payable + totals.concepts.HEFD.payable + totals.concepts.HEFN.payable,
            )}
          />
          <StatTile
            label="Extra sin aprobar"
            value={fmt(totals.pendingOvertimeHours)}
            tone={totals.pendingOvertimeHours > 0 ? 'warning' : undefined}
          />
          <StatTile
            label="Llegadas tarde"
            value={totals.lateCount > 0 ? `${totals.lateCount} (${fmt(totals.lateHours)} h)` : '0'}
            tone={totals.lateCount > 0 ? 'warning' : undefined}
          />
          <StatTile
            label="Salidas anticipadas"
            value={String(totals.earlyExitCount)}
            tone={totals.earlyExitCount > 0 ? 'warning' : undefined}
          />
          <StatTile label="Ausencias" value={String(totals.absenceCount)} tone={totals.absenceCount > 0 ? 'critical' : undefined} />
          <StatTile label="Permisos / incap." value={`${totals.permissionDays} / ${totals.sickLeaveDays}`} />
        </div>
      )}

      <Card className="overflow-hidden">
        {loading && !grid ? (
          <p className="p-6 text-center text-sm text-ink-muted">Cargando...</p>
        ) : !grid ? (
          <p className="p-6 text-center text-sm text-ink-muted">Elige un empleado y un periodo.</p>
        ) : (
          <div className={clsx('overflow-x-auto', loading && 'opacity-60')}>
            <table className="w-full min-w-[1240px] border-collapse text-xs">
              <thead>
                <tr className="bg-surface-page text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  <th colSpan={2} className="sticky left-0 z-10 bg-surface-page px-2 py-1.5 text-left">
                    {grid.employee.fullName}
                  </th>
                  <th colSpan={12} className="border-l border-line-axis py-1.5">
                    a. m.
                  </th>
                  <th colSpan={12} className="border-l border-line-axis py-1.5">
                    p. m.
                  </th>
                  <th colSpan={3} className="border-l border-line-axis py-1.5">
                    Marcas
                  </th>
                  <th colSpan={7} className="border-l border-line-axis py-1.5">
                    Novedades de nomina (horas)
                  </th>
                  <th className="border-l border-line-axis py-1.5" />
                </tr>
                <tr className="border-b border-line-axis text-[10px] font-semibold text-ink-secondary">
                  <th className="sticky left-0 z-10 w-10 bg-surface-card px-2 py-1.5 text-left">Dia</th>
                  <th className="sticky left-10 z-10 w-20 bg-surface-card px-2 py-1.5 text-left">Fecha</th>
                  {[0, 1].map((half) =>
                    HOUR_LABELS.map((label, i) => (
                      <th
                        key={`${half}-${label}`}
                        title={`De ${label}:00 a ${label === '12' ? 1 : Number(label) + 1}:00 ${half === 0 ? 'a. m.' : 'p. m.'}`}
                        className={clsx('w-[22px] min-w-[22px] px-0 py-1.5 font-medium', i === 0 ? 'border-l border-line-axis' : 'border-l border-line-hair')}
                      >
                        {label}
                      </th>
                    )),
                  )}
                  <th className="border-l border-line-axis px-2 py-1.5">Entrada</th>
                  <th className="px-2 py-1.5">Salida</th>
                  <th className="px-2 py-1.5">Horas</th>
                  {GRID_CONCEPTS.map((c, i) => (
                    <th
                      key={c}
                      title={CONCEPT_INFO[c].title}
                      className={clsx('px-1.5 py-1.5', i === 0 ? 'border-l border-line-axis' : 'border-l border-line-hair')}
                    >
                      {CONCEPT_INFO[c].label}
                    </th>
                  ))}
                  <th className="border-l border-line-axis px-2 py-1.5 text-left">Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {grid.days.map((day) => {
                  const restTone = day.isHoliday || day.isSunday;
                  const rowBg = restTone ? 'bg-amber-50' : 'bg-surface-card';
                  return (
                    <tr key={day.date} className={clsx('border-b border-line-hair', rowBg)}>
                      <td className={clsx('sticky left-0 z-10 px-2 py-1 font-semibold tabular-nums text-ink', rowBg)}>{day.dayOfMonth}</td>
                      <td className={clsx('sticky left-10 z-10 whitespace-nowrap px-2 py-1 text-ink-secondary', rowBg)}>
                        {WEEKDAYS[day.weekday]} {day.date.slice(8)}/{day.date.slice(5, 7)}
                        {day.isHoliday && <span className="ml-1 font-medium text-amber-700">festivo</span>}
                      </td>
                      {day.hours.map((value, h) => (
                        <HourCell key={h} value={value} />
                      ))}
                      <td className="whitespace-nowrap border-l border-line-axis px-2 py-1 text-center tabular-nums text-ink">
                        {timeOf(day.marks.checkIn, day.date)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-center tabular-nums text-ink">
                        {day.marks.checkIn && !day.marks.checkOut ? (
                          <span className="font-medium text-red-700">sin salida</span>
                        ) : (
                          timeOf(day.marks.checkOut, day.date)
                        )}
                      </td>
                      <td className="px-2 py-1 text-center font-semibold tabular-nums text-ink">
                        {day.workedHours > 0 ? fmt(day.workedHours) : ''}
                      </td>
                      {GRID_CONCEPTS.map((c) => (
                        <ConceptCell key={c} day={day} concept={c} />
                      ))}
                      <td className="border-l border-line-axis px-2 py-1 text-ink-secondary">
                        {day.others.map((o, i) => (
                          <Fragment key={`${o.code}-${i}`}>
                            {i > 0 && '; '}
                            <span
                              title={o.notes ?? undefined}
                              className={clsx(
                                o.code === 'AUSENCIA_INJUSTIFICADA' && 'font-medium text-red-700',
                                (o.code === 'LLEGADA_TARDE' || o.code === 'SALIDA_ANTICIPADA') && 'font-medium text-amber-700',
                              )}
                            >
                              {o.label}
                              {o.hours > 0 ? ` (${fmt(o.hours)} h)` : ''}
                            </span>
                          </Fragment>
                        ))}
                        {day.others.length === 0 && !day.marks.checkIn && day.planned === 'Descanso' && (
                          <span className="text-ink-muted">Descanso</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-axis bg-surface-page font-semibold text-ink">
                  <td colSpan={2} className="sticky left-0 z-10 bg-surface-page px-2 py-2 text-left">
                    Totales
                  </td>
                  <td colSpan={24} className="border-l border-line-axis px-2 py-2 text-left text-[11px] font-normal text-ink-secondary">
                    CC {grid.employee.nationalId} · Codigo {grid.employee.employeeCode}
                  </td>
                  <td colSpan={2} className="border-l border-line-axis" />
                  <td className="px-2 py-2 text-center tabular-nums">{fmt(grid.totals.workedHours)}</td>
                  {GRID_CONCEPTS.map((c, i) => {
                    const t = grid.totals.concepts[c];
                    return (
                      <td
                        key={c}
                        className={clsx('px-1.5 py-2 text-center tabular-nums', i === 0 ? 'border-l border-line-axis' : 'border-l border-line-hair')}
                      >
                        {fmt(t.payable)}
                        {t.pending > 0 && <div className="text-[10px] font-medium text-amber-700">{fmt(t.pending)} pend.</div>}
                        {t.rejected > 0 && <div className="text-[10px] font-medium text-red-700 line-through">{fmt(t.rejected)}</div>}
                      </td>
                    );
                  })}
                  <td className="border-l border-line-axis" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 bg-emerald-600" /> Hora completa trabajada
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 bg-emerald-200" /> Fraccion de hora
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 border border-line-hair bg-amber-50" /> Domingo o festivo
        </span>
        <span className="font-medium text-amber-700">pend.</span>
        <span>= hora extra sin aprobar (aun no entra a nomina)</span>
        <span>
          En turnos de noche las horas se pintan en el dia en que realmente se trabajaron; sus novedades quedan en el dia en que
          inicio el turno.
        </span>
      </div>
    </div>
  );
}
