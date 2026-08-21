'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Calculator, Loader2, Trash2 } from 'lucide-react';
import { DailyCalculationResult, Employee, deleteManualDay, getEmployees, getManualRange, upsertManualDay } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { NOVELTY_BADGE_CLASS, NOVELTY_LABELS } from '@/lib/novelty-labels';

const inputClass =
  'w-full rounded-md border border-line-axis bg-surface-card px-2 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-100';

const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

interface DayRow {
  workDate: string;
  checkIn: string;
  lunchOut: string;
  lunchIn: string;
  checkOut: string;
  result: DailyCalculationResult | null;
  saving: boolean;
  error: string | null;
}

function listDatesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

function formatDayLabel(workDate: string): string {
  const d = new Date(`${workDate}T00:00:00`);
  return `${WEEKDAY_LABELS[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

function isWeekend(workDate: string): boolean {
  const day = new Date(`${workDate}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

export default function ManualPayrollPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Cargando...</p>}>
      <ManualPayrollPageInner />
    </Suspense>
  );
}

function ManualPayrollPageInner() {
  const searchParams = useSearchParams();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<DayRow[]>([]);
  const [loadingRange, setLoadingRange] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const rowsRef = useRef<DayRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    getEmployees()
      .then(setEmployees)
      .catch(() => {});
  }, []);

  // Permite llegar con un enlace directo desde Historial de Marcas ya
  // apuntando a un empleado y fecha, en vez de tener que reseleccionarlos.
  useEffect(() => {
    const qEmployeeId = searchParams.get('employeeId');
    const qDate = searchParams.get('date');
    const qFrom = searchParams.get('from') ?? qDate;
    const qTo = searchParams.get('to') ?? qDate;
    if (!qEmployeeId || !qFrom || !qTo) return;
    setEmployeeId(qEmployeeId);
    setFrom(qFrom);
    setTo(qTo);
    handleGenerate(qEmployeeId, qFrom, qTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleGenerate(overrideEmployeeId?: string, overrideFrom?: string, overrideTo?: string) {
    const empId = overrideEmployeeId ?? employeeId;
    const f = overrideFrom ?? from;
    const t = overrideTo ?? to;
    if (!empId || !f || !t) return;
    setRangeError(null);
    setLoadingRange(true);
    try {
      const existing = await getManualRange(empId, f, t);
      const existingByDate = Object.fromEntries(existing.map((d) => [d.workDate, d]));
      const dates = listDatesBetween(f, t);
      setRows(
        dates.map((workDate) => {
          const ex = existingByDate[workDate];
          return {
            workDate,
            checkIn: ex?.checkIn ?? '',
            lunchOut: ex?.lunchOut ?? '',
            lunchIn: ex?.lunchIn ?? '',
            checkOut: ex?.checkOut ?? '',
            result: ex && (ex.novelties.length > 0 || ex.totalWorkedHours > 0)
              ? {
                  userId: empId,
                  workDate,
                  novelties: ex.novelties,
                  totalOrdinaryHours: ex.totalOrdinaryHours,
                  totalOvertimeHours: ex.totalOvertimeHours,
                  totalWorkedHours: ex.totalWorkedHours,
                  hasPendingOvertime: false,
                }
              : null,
            saving: false,
            error: null,
          };
        }),
      );
    } catch (err) {
      setRangeError((err as Error).message);
    } finally {
      setLoadingRange(false);
    }
  }

  function updateField(workDate: string, field: 'checkIn' | 'lunchOut' | 'lunchIn' | 'checkOut', value: string) {
    setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, [field]: value } : r)));

    if (debounceTimers.current[workDate]) clearTimeout(debounceTimers.current[workDate]);
    debounceTimers.current[workDate] = setTimeout(() => calculateDay(workDate), 600);
  }

  async function calculateDay(workDate: string) {
    const row = rowsRef.current.find((r) => r.workDate === workDate);
    if (!row) return;

    if (!row.checkIn && !row.lunchOut && !row.lunchIn && !row.checkOut) {
      setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, result: null, error: null } : r)));
      return;
    }

    setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, saving: true, error: null } : r)));
    try {
      const result = await upsertManualDay({
        userId: employeeId,
        workDate,
        checkIn: row.checkIn || undefined,
        lunchOut: row.lunchOut || undefined,
        lunchIn: row.lunchIn || undefined,
        checkOut: row.checkOut || undefined,
      });
      setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, result, saving: false } : r)));
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, saving: false, error: (err as Error).message } : r)));
    }
  }

  async function handleDeleteDay(workDate: string) {
    if (!confirm('¿Borrar todas las marcas de este día? Esta acción no se puede deshacer.')) return;
    if (debounceTimers.current[workDate]) clearTimeout(debounceTimers.current[workDate]);
    setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, saving: true, error: null } : r)));
    try {
      await deleteManualDay(employeeId, workDate);
      setRows((prev) =>
        prev.map((r) =>
          r.workDate === workDate
            ? { ...r, checkIn: '', lunchOut: '', lunchIn: '', checkOut: '', result: null, saving: false }
            : r,
        ),
      );
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, saving: false, error: (err as Error).message } : r)));
    }
  }

  const totals = useMemo(() => {
    const byCode: Record<string, number> = {};
    let totalWorked = 0;
    let totalOrdinary = 0;
    let totalOvertime = 0;
    for (const row of rows) {
      if (!row.result) continue;
      totalWorked += row.result.totalWorkedHours;
      totalOrdinary += row.result.totalOrdinaryHours;
      totalOvertime += row.result.totalOvertimeHours;
      for (const n of row.result.novelties) {
        byCode[n.code] = (byCode[n.code] ?? 0) + n.hours;
      }
    }
    return { byCode, totalWorked, totalOrdinary, totalOvertime };
  }, [rows]);

  const selectedEmployee = employees.find((e) => e.id === employeeId);
  const daysWithData = rows.filter((r) => r.result).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Corregir Marcas y Novedades"
        subtitle="Aqui puedes cambiar la hora de entrada o salida que ya marco un empleado (si se equivoco, olvido marcar, o vienes de una planilla en papel). Al guardar, el sistema recalcula automaticamente llegadas tarde, salidas anticipadas, horas extra y demas novedades con el mismo motor del kiosco."
      />

      <Card className="p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-ink-secondary">Empleado</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`mt-1 w-full ${inputClass}`}>
              <option value="">Selecciona un empleado...</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} · {e.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-secondary">Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-secondary">Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => handleGenerate()} disabled={!employeeId || !from || !to || loadingRange}>
            {loadingRange ? <Loader2 size={15} className="animate-spin" /> : <Calculator size={15} />}
            Generar dias
          </Button>
        </div>
        {rangeError && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{rangeError}</p>}
      </Card>

      {rows.length > 0 && (
        <>
          <Card className="sticky top-4 z-10 p-5">
            <div className="text-sm font-semibold text-ink">
              Total {selectedEmployee ? `— ${selectedEmployee.fullName}` : ''} ({daysWithData}/{rows.length} dias calculados)
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              <div>
                <div className="text-xs text-ink-muted">Horas ordinarias</div>
                <div className="text-lg font-semibold text-ink">{totals.totalOrdinary.toFixed(2)}h</div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">Horas extra</div>
                <div className="text-lg font-semibold text-ink">{totals.totalOvertime.toFixed(2)}h</div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">Total trabajado</div>
                <div className="text-lg font-semibold text-ink">{totals.totalWorked.toFixed(2)}h</div>
              </div>
            </div>
            {Object.keys(totals.byCode).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line-hair pt-3">
                {Object.entries(totals.byCode).map(([code, hours]) => (
                  <Badge key={code} tone="info">
                    {NOVELTY_LABELS[code] ?? code}: {hours.toFixed(2)}h
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="divide-y divide-line-hair">
              {rows.map((row) => (
                <div key={row.workDate} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${isWeekend(row.workDate) ? 'bg-surface-page' : ''}`}>
                  <div className="w-32 shrink-0 text-sm font-medium capitalize text-ink">{formatDayLabel(row.workDate)}</div>

                  <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <label className="block text-xs text-ink-muted">Entrada</label>
                      <input
                        type="time"
                        value={row.checkIn}
                        onChange={(e) => updateField(row.workDate, 'checkIn', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-muted">Salida almuerzo</label>
                      <input
                        type="time"
                        value={row.lunchOut}
                        onChange={(e) => updateField(row.workDate, 'lunchOut', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-muted">Reingreso almuerzo</label>
                      <input
                        type="time"
                        value={row.lunchIn}
                        onChange={(e) => updateField(row.workDate, 'lunchIn', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-muted">Salida</label>
                      <input
                        type="time"
                        value={row.checkOut}
                        onChange={(e) => updateField(row.workDate, 'checkOut', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div className="flex min-h-[28px] flex-wrap items-center gap-1.5 sm:w-64 sm:justify-end">
                    {row.saving && <Loader2 size={14} className="animate-spin text-ink-muted" />}
                    {row.error && <span className="text-xs text-red-700">{row.error}</span>}
                    {!row.saving &&
                      !row.error &&
                      row.result &&
                      (row.result.novelties.length > 0 ? (
                        row.result.novelties.map((n, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${NOVELTY_BADGE_CLASS[n.status] ?? NOVELTY_BADGE_CLASS.AUTO_CALCULADA}`}
                          >
                            {NOVELTY_LABELS[n.code] ?? n.code}: {n.hours}h
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-ink-muted">Sin novedades</span>
                      ))}
                    {(row.checkIn || row.lunchOut || row.lunchIn || row.checkOut) && !row.saving && (
                      <button
                        type="button"
                        onClick={() => handleDeleteDay(row.workDate)}
                        title="Borrar todas las marcas de este día"
                        className="rounded-md p-1 text-ink-muted hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
