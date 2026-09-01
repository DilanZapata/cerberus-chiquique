'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Calculator, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  BulkDeletePreview,
  CalculatedNovelty,
  Employee,
  TimeLogMark,
  bulkDeleteMarks,
  createMark,
  deleteMark,
  getEmployees,
  getManualRange,
  previewBulkDeleteMarks,
  updateMarkTime,
} from '@/lib/api';
import { getUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { NOVELTY_BADGE_CLASS, NOVELTY_LABELS } from '@/lib/novelty-labels';

const inputClass =
  'w-full rounded-md border border-line-axis bg-surface-card px-2 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-100';

const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const MARK_TYPE_LABELS: Record<TimeLogMark['logType'], string> = {
  CHECK_IN: 'Entrada',
  LUNCH_OUT: 'Salida almuerzo',
  LUNCH_IN: 'Reingreso almuerzo',
  CHECK_OUT: 'Salida',
};

interface DayRow {
  workDate: string;
  marks: TimeLogMark[];
  novelties: CalculatedNovelty[];
  totalOrdinaryHours: number;
  totalOvertimeHours: number;
  totalWorkedHours: number;
  busyMarkId: string | null;
  addingType: TimeLogMark['logType'] | '';
  addingTime: string;
  addBusy: boolean;
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

function DangerZone({ employees }: { employees: Employee[] }) {
  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<BulkDeletePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  async function handlePreview() {
    if (!from || !to) return;
    setError(null);
    setResult(null);
    setPreview(null);
    setLoadingPreview(true);
    try {
      const p = await previewBulkDeleteMarks(from, to, employeeId || undefined);
      setPreview(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleDelete() {
    if (!preview) return;
    const scope = selectedEmployee ? selectedEmployee.fullName : `TODOS los trabajadores (${preview.usersAffected})`;
    const confirmed = confirm(
      `Vas a borrar ${preview.timeLogsCount} marcas y ${preview.noveltiesCount} novedades de ${scope}, entre ${from} y ${to}.\n\n` +
        'Esta accion NO se puede deshacer. ¿Confirmas?',
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await bulkDeleteMarks(from, to, employeeId || undefined);
      setResult(`Se borraron ${res.timeLogsDeleted} marcas, ${res.noveltiesDeleted} novedades y ${res.totalsDeleted} totales.`);
      setPreview(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="border-red-200 bg-red-50/40 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
        <AlertTriangle size={16} /> Zona de peligro: borrar marcas
      </div>
      <p className="mt-1 text-xs text-ink-secondary">
        Borra permanentemente las marcas (y las novedades/totales calculados a partir de ellas) de un rango de fechas. Puedes elegir un
        trabajador puntual o dejarlo en blanco para borrar de todos los trabajadores de la empresa. No hay forma de deshacer esto.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-ink-secondary">Trabajador</label>
          <select
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setPreview(null);
              setResult(null);
            }}
            className={`mt-1 w-full ${inputClass}`}
          >
            <option value="">Todos los trabajadores</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.employeeCode} · {e.fullName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-secondary">Desde</label>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPreview(null);
              setResult(null);
            }}
            className={`mt-1 w-full ${inputClass}`}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-secondary">Hasta</label>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPreview(null);
              setResult(null);
            }}
            className={`mt-1 w-full ${inputClass}`}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={handlePreview} disabled={!from || !to || loadingPreview}>
          {loadingPreview ? <Loader2 size={15} className="animate-spin" /> : null}
          Ver cuantas marcas se borrarian
        </Button>

        {preview && (
          <>
            <span className="text-sm text-ink-secondary">
              {preview.timeLogsCount} marcas · {preview.noveltiesCount} novedades · {preview.totalsCount} totales ·{' '}
              {preview.usersAffected} trabajador{preview.usersAffected === 1 ? '' : 'es'}
            </span>
            {preview.timeLogsCount > 0 && (
              <Button variant="danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Borrar definitivamente
              </Button>
            )}
          </>
        )}
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-100 p-2 text-sm text-red-700">{error}</p>}
      {result && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{result}</p>}
    </Card>
  );
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

  function dayRowFrom(workDate: string, ex: Awaited<ReturnType<typeof getManualRange>>[number] | undefined): DayRow {
    return {
      workDate,
      marks: ex?.marks ?? [],
      novelties: ex?.novelties ?? [],
      totalOrdinaryHours: ex?.totalOrdinaryHours ?? 0,
      totalOvertimeHours: ex?.totalOvertimeHours ?? 0,
      totalWorkedHours: ex?.totalWorkedHours ?? 0,
      busyMarkId: null,
      addingType: '',
      addingTime: '',
      addBusy: false,
      error: null,
    };
  }

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
      setRows(dates.map((workDate) => dayRowFrom(workDate, existingByDate[workDate])));
    } catch (err) {
      setRangeError((err as Error).message);
    } finally {
      setLoadingRange(false);
    }
  }

  /** Vuelve a traer un solo dia del servidor y reemplaza esa fila, para no tener que reconstruir el estado a mano tras editar/borrar/agregar una marca. */
  async function refreshDay(workDate: string) {
    const empId = employeeId;
    if (!empId) return;
    try {
      const [ex] = await getManualRange(empId, workDate, workDate);
      setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...dayRowFrom(workDate, ex), addingType: r.addingType } : r)));
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, busyMarkId: null, error: (err as Error).message } : r)));
    }
  }

  function handleEditMarkTime(workDate: string, markId: string, time: string) {
    setRows((prev) =>
      prev.map((r) => (r.workDate === workDate ? { ...r, marks: r.marks.map((m) => (m.id === markId ? { ...m, time } : m)) } : r)),
    );

    const timerKey = `${workDate}:${markId}`;
    if (debounceTimers.current[timerKey]) clearTimeout(debounceTimers.current[timerKey]);
    debounceTimers.current[timerKey] = setTimeout(async () => {
      setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, busyMarkId: markId, error: null } : r)));
      const row = rowsSnapshot(workDate);
      const mark = row?.marks.find((m) => m.id === markId);
      if (!mark) return;
      try {
        await updateMarkTime(markId, mark.time);
        await refreshDay(workDate);
      } catch (err) {
        setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, busyMarkId: null, error: (err as Error).message } : r)));
      }
    }, 600);
  }

  const rowsRef = useRef<DayRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  function rowsSnapshot(workDate: string) {
    return rowsRef.current.find((r) => r.workDate === workDate);
  }

  async function handleDeleteMark(workDate: string, markId: string) {
    if (!confirm('¿Borrar esta marca? Esta acción no se puede deshacer.')) return;
    setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, busyMarkId: markId, error: null } : r)));
    try {
      await deleteMark(markId);
      await refreshDay(workDate);
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, busyMarkId: null, error: (err as Error).message } : r)));
    }
  }

  async function handleAddMark(workDate: string) {
    const row = rowsSnapshot(workDate);
    if (!row || !row.addingType || !row.addingTime) return;
    setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, addBusy: true, error: null } : r)));
    try {
      await createMark(employeeId, workDate, row.addingType, row.addingTime);
      await refreshDay(workDate);
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.workDate === workDate ? { ...r, addBusy: false, error: (err as Error).message } : r)));
    }
  }

  const totals = useMemo(() => {
    const byCode: Record<string, number> = {};
    let totalWorked = 0;
    let totalOrdinary = 0;
    let totalOvertime = 0;
    for (const row of rows) {
      totalWorked += row.totalWorkedHours;
      totalOrdinary += row.totalOrdinaryHours;
      totalOvertime += row.totalOvertimeHours;
      for (const n of row.novelties) {
        byCode[n.code] = (byCode[n.code] ?? 0) + n.hours;
      }
    }
    return { byCode, totalWorked, totalOrdinary, totalOvertime };
  }, [rows]);

  const selectedEmployee = employees.find((e) => e.id === employeeId);
  const daysWithData = rows.filter((r) => r.marks.length > 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Corregir Marcas y Novedades"
        subtitle="Selecciona un empleado y un rango de fechas: aqui aparecen las marcas reales que registro ese dia (entrada, salida, almuerzo). Puedes cambiar la hora de cualquiera, borrarla, o agregar una que falte. Al guardar, el sistema recalcula automaticamente llegadas tarde, salidas anticipadas, horas extra y demas novedades con el mismo motor del kiosco."
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
              Total {selectedEmployee ? `— ${selectedEmployee.fullName}` : ''} ({daysWithData}/{rows.length} dias con marcas)
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
                <div key={row.workDate} className={`p-4 ${isWeekend(row.workDate) ? 'bg-surface-page' : ''}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="w-32 shrink-0 pt-1.5 text-sm font-medium capitalize text-ink">{formatDayLabel(row.workDate)}</div>

                    <div className="flex-1 space-y-2">
                      {row.marks.length === 0 && <p className="text-xs text-ink-muted">Sin marcas registradas.</p>}
                      {row.marks.map((mark) => (
                        <div key={mark.id} className="flex flex-wrap items-center gap-2">
                          <span className="w-36 shrink-0 text-xs text-ink-secondary">{MARK_TYPE_LABELS[mark.logType]}</span>
                          <input
                            type="time"
                            value={mark.time}
                            onChange={(e) => handleEditMarkTime(row.workDate, mark.id, e.target.value)}
                            className={`${inputClass} w-32`}
                          />
                          {mark.source === 'MANUAL' && (
                            <span className="text-xs text-ink-muted" title="Marca corregida o cargada manualmente">
                              corregida
                            </span>
                          )}
                          {row.busyMarkId === mark.id ? (
                            <Loader2 size={14} className="animate-spin text-ink-muted" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDeleteMark(row.workDate, mark.id)}
                              title="Borrar esta marca"
                              className="rounded-md p-1 text-ink-muted hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      ))}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <select
                          value={row.addingType}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r) =>
                                r.workDate === row.workDate ? { ...r, addingType: e.target.value as TimeLogMark['logType'] | '' } : r,
                              ),
                            )
                          }
                          className={`${inputClass} w-40`}
                        >
                          <option value="">Agregar marca...</option>
                          {(Object.keys(MARK_TYPE_LABELS) as TimeLogMark['logType'][])
                            .filter((t) => !row.marks.some((m) => m.logType === t))
                            .map((t) => (
                              <option key={t} value={t}>
                                {MARK_TYPE_LABELS[t]}
                              </option>
                            ))}
                        </select>
                        <input
                          type="time"
                          value={row.addingTime}
                          onChange={(e) =>
                            setRows((prev) => prev.map((r) => (r.workDate === row.workDate ? { ...r, addingTime: e.target.value } : r)))
                          }
                          className={`${inputClass} w-32`}
                        />
                        <Button
                          variant="secondary"
                          onClick={() => handleAddMark(row.workDate)}
                          disabled={!row.addingType || !row.addingTime || row.addBusy}
                        >
                          {row.addBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                          Agregar
                        </Button>
                      </div>

                      {row.error && <p className="text-xs text-red-700">{row.error}</p>}
                    </div>

                    <div className="flex min-h-[24px] flex-wrap items-center gap-1.5 sm:w-56 sm:justify-end">
                      {row.novelties.length > 0 ? (
                        row.novelties.map((n, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${NOVELTY_BADGE_CLASS[n.status] ?? NOVELTY_BADGE_CLASS.AUTO_CALCULADA}`}
                          >
                            {NOVELTY_LABELS[n.code] ?? n.code}: {n.hours}h
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-ink-muted">Sin novedades</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {getUser()?.role === 'ADMIN' && <DangerZone employees={employees} />}
    </div>
  );
}
