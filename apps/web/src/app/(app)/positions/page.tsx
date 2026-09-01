'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Briefcase, CalendarClock, Pencil, Plus, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  createPosition,
  createSchedule,
  DayOfWeek,
  getPositions,
  getSchedules,
  Position,
  ScheduleDayInput,
  ScheduleSummary,
  updatePosition,
  updateSchedule,
} from '@/lib/api';

const inputClass =
  'rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-ink-secondary';

const DAYS: { value: DayOfWeek; label: string }[] = [
  { value: 'MONDAY', label: 'Lunes' },
  { value: 'TUESDAY', label: 'Martes' },
  { value: 'WEDNESDAY', label: 'Miercoles' },
  { value: 'THURSDAY', label: 'Jueves' },
  { value: 'FRIDAY', label: 'Viernes' },
  { value: 'SATURDAY', label: 'Sabado' },
  { value: 'SUNDAY', label: 'Domingo' },
];

function defaultDays(): ScheduleDayInput[] {
  return DAYS.map(({ value }) => ({
    dayOfWeek: value,
    isWorkingDay: value !== 'SUNDAY',
    startTime: value === 'SATURDAY' ? '08:00' : '08:00',
    endTime: value === 'SATURDAY' ? '12:00' : '17:00',
  }));
}

function summarizeSchedule(schedule: ScheduleSummary): string {
  if (!schedule.details || schedule.details.length === 0) return 'Sin dias configurados';
  const working = schedule.details.filter((d) => d.isWorkingDay);
  if (working.length === 0) return 'Sin dias laborales';
  // Agrupa dias consecutivos con el mismo horario para un resumen corto (ej. "L-V 08:00-16:00, Sab 08:00-12:00").
  const order: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  const short: Record<DayOfWeek, string> = {
    MONDAY: 'L',
    TUESDAY: 'M',
    WEDNESDAY: 'X',
    THURSDAY: 'J',
    FRIDAY: 'V',
    SATURDAY: 'Sab',
    SUNDAY: 'Dom',
  };
  const parts: string[] = [];
  let i = 0;
  const sorted = order.map((day) => schedule.details!.find((d) => d.dayOfWeek === day)).filter((d): d is NonNullable<typeof d> => !!d);
  while (i < sorted.length) {
    const day = sorted[i];
    if (!day.isWorkingDay) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].isWorkingDay && sorted[j + 1].startTime === day.startTime && sorted[j + 1].endTime === day.endTime) {
      j++;
    }
    const label = i === j ? short[day.dayOfWeek] : `${short[day.dayOfWeek]}-${short[sorted[j].dayOfWeek]}`;
    parts.push(`${label} ${day.startTime}-${day.endTime}`);
    i = j + 1;
  }
  return parts.join(', ') || 'Sin dias laborales';
}

function ScheduleForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: ScheduleSummary;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [weeklyHoursTarget, setWeeklyHoursTarget] = useState(initial?.weeklyHoursTarget ?? '42');
  const [defaultLunchMinutes, setDefaultLunchMinutes] = useState(String(initial?.defaultLunchMinutes ?? 60));
  const [lunchWindowStart, setLunchWindowStart] = useState(initial?.lunchWindowStart ?? '12:00');
  const [lunchWindowEnd, setLunchWindowEnd] = useState(initial?.lunchWindowEnd ?? '14:00');
  const [lunchToleranceMinutes, setLunchToleranceMinutes] = useState(String(initial?.lunchToleranceMinutes ?? 10));
  const [finalExitWindowBeforeMin, setFinalExitWindowBeforeMin] = useState(String(initial?.finalExitWindowBeforeMin ?? 30));
  const [finalExitGraceMin, setFinalExitGraceMin] = useState(String(initial?.finalExitGraceMin ?? 180));
  const [days, setDays] = useState<ScheduleDayInput[]>(() => {
    if (!initial?.details) return defaultDays();
    return DAYS.map(({ value }) => {
      const d = initial.details!.find((x) => x.dayOfWeek === value);
      return {
        dayOfWeek: value,
        isWorkingDay: d?.isWorkingDay ?? false,
        startTime: d?.startTime ?? '08:00',
        endTime: d?.endTime ?? '17:00',
      };
    });
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateDay(index: number, patch: Partial<ScheduleDayInput>) {
    setDays((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        name,
        weeklyHoursTarget: weeklyHoursTarget ? Number(weeklyHoursTarget) : undefined,
        defaultLunchMinutes: defaultLunchMinutes ? Number(defaultLunchMinutes) : undefined,
        lunchWindowStart: lunchWindowStart || undefined,
        lunchWindowEnd: lunchWindowEnd || undefined,
        lunchToleranceMinutes: lunchToleranceMinutes ? Number(lunchToleranceMinutes) : undefined,
        finalExitWindowBeforeMin: finalExitWindowBeforeMin ? Number(finalExitWindowBeforeMin) : undefined,
        finalExitGraceMin: finalExitGraceMin ? Number(finalExitGraceMin) : undefined,
        days,
      };
      if (initial) {
        await updateSchedule(initial.id, body);
      } else {
        await createSchedule(body);
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-brand-100 bg-surface-page p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">{initial ? 'Editar horario' : 'Nuevo horario'}</span>
        <button type="button" onClick={onCancel} className="text-ink-muted hover:text-ink">
          <X size={16} />
        </button>
      </div>

      <div>
        <label className={labelClass}>Nombre del horario</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. Cajero 8-4" className={`mt-1 w-full ${inputClass}`} />
      </div>
      <div>
        <label className={labelClass}>Horas semanales objetivo (opcional)</label>
        <input
          type="number"
          min={0}
          value={weeklyHoursTarget}
          onChange={(e) => setWeeklyHoursTarget(e.target.value)}
          className={`mt-1 w-full ${inputClass}`}
        />
      </div>

      <div className="space-y-2 rounded-md bg-surface-page p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Almuerzo</span>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Entrada a almorzar (desde)</label>
            <input
              type="time"
              value={lunchWindowStart}
              onChange={(e) => setLunchWindowStart(e.target.value)}
              className={`mt-1 w-full ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass}>Regreso de almuerzo (hasta)</label>
            <input
              type="time"
              value={lunchWindowEnd}
              onChange={(e) => setLunchWindowEnd(e.target.value)}
              className={`mt-1 w-full ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass}>Duracion (min)</label>
            <input
              type="number"
              min={0}
              value={defaultLunchMinutes}
              onChange={(e) => setDefaultLunchMinutes(e.target.value)}
              className={`mt-1 w-full ${inputClass}`}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Tolerancia (min)</label>
          <input
            type="number"
            min={0}
            value={lunchToleranceMinutes}
            onChange={(e) => setLunchToleranceMinutes(e.target.value)}
            className={`mt-1 w-32 ${inputClass}`}
          />
          <p className="mt-1 text-xs text-ink-muted">
            Ventana en la que se puede marcar la salida/regreso de almuerzo sin generar novedad de tardanza.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Ventana de salida final (min antes)</label>
          <input
            type="number"
            min={0}
            value={finalExitWindowBeforeMin}
            onChange={(e) => setFinalExitWindowBeforeMin(e.target.value)}
            className={`mt-1 w-full ${inputClass}`}
          />
          <p className="mt-1 text-xs text-ink-muted">
            Desde cuantos minutos antes de la hora de salida, una marca siempre se interpreta como salida final.
          </p>
        </div>
        <div>
          <label className={labelClass}>Margen para cierre automatico (min)</label>
          <input
            type="number"
            min={0}
            value={finalExitGraceMin}
            onChange={(e) => setFinalExitGraceMin(e.target.value)}
            className={`mt-1 w-full ${inputClass}`}
          />
          <p className="mt-1 text-xs text-ink-muted">
            Cuanto tiempo despues de la salida programada se espera antes de cerrar la jornada automaticamente si nadie marco salida.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {DAYS.map(({ value, label }, i) => (
          <div key={value} className="flex items-center gap-2 rounded-md bg-surface-card p-2">
            <label className="flex w-28 shrink-0 items-center gap-1.5 text-xs font-medium text-ink">
              <input
                type="checkbox"
                checked={days[i].isWorkingDay}
                onChange={(e) => updateDay(i, { isWorkingDay: e.target.checked })}
              />
              {label}
            </label>
            {days[i].isWorkingDay ? (
              <>
                <input
                  type="time"
                  required
                  value={days[i].startTime ?? ''}
                  onChange={(e) => updateDay(i, { startTime: e.target.value })}
                  className={`${inputClass} flex-1`}
                />
                <span className="text-xs text-ink-muted">a</span>
                <input
                  type="time"
                  required
                  value={days[i].endTime ?? ''}
                  onChange={(e) => updateDay(i, { endTime: e.target.value })}
                  className={`${inputClass} flex-1`}
                />
              </>
            ) : (
              <span className="flex-1 text-xs text-ink-muted">Descanso</span>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      <Button disabled={saving} type="submit" className="w-full">
        {saving ? 'Guardando...' : 'Guardar horario'}
      </Button>
    </form>
  );
}

function SchedulesSection({
  schedules,
  onChanged,
}: {
  schedules: ScheduleSummary[];
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarClock size={16} /> Horarios
        </div>
        {!creating && (
          <Button variant="secondary" onClick={() => setCreating(true)}>
            <Plus size={15} /> Nuevo horario
          </Button>
        )}
      </div>

      {creating && (
        <div className="mt-3">
          <ScheduleForm
            onSaved={() => {
              setCreating(false);
              onChanged();
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {schedules.map((s) =>
          editingId === s.id ? (
            <li key={s.id}>
              <ScheduleForm
                initial={s}
                onSaved={() => {
                  setEditingId(null);
                  onChanged();
                }}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={s.id} className="rounded-md bg-surface-page px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">{s.name}</span>
                <button onClick={() => setEditingId(s.id)} className="text-ink-muted hover:text-ink" title="Editar horario">
                  <Pencil size={13} />
                </button>
              </div>
              <div className="mt-0.5 text-xs text-ink-muted">{summarizeSchedule(s)}</div>
            </li>
          ),
        )}
        {schedules.length === 0 && !creating && <li className="text-sm text-ink-muted">Aun no hay horarios.</li>}
      </ul>
    </Card>
  );
}

function PositionForm({
  initial,
  schedules,
  onSaved,
  onCancel,
}: {
  initial?: Position;
  schedules: ScheduleSummary[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [scheduleId, setScheduleId] = useState(initial?.scheduleId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { name, scheduleId: scheduleId || undefined };
      if (initial) {
        await updatePosition(initial.id, body);
      } else {
        await createPosition(body);
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-brand-100 bg-surface-page p-3">
      <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. Cajero" className={`w-full ${inputClass}`} />
      <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} className={`w-full ${inputClass}`}>
        <option value="">Sin horario asignado</option>
        {schedules.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button disabled={saving} type="submit" className="flex-1">
          {saving ? 'Guardando...' : 'Guardar'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function PositionsSection({
  positions,
  schedules,
  onChanged,
}: {
  positions: Position[];
  schedules: ScheduleSummary[];
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Briefcase size={16} /> Cargos
        </div>
        {!creating && (
          <Button variant="secondary" onClick={() => setCreating(true)}>
            <Plus size={15} /> Nuevo cargo
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Asignale un cargo a un empleado (desde Empleados) y automaticamente queda con el horario de entrada y salida de ese cargo.
      </p>

      {creating && (
        <div className="mt-3">
          <PositionForm
            schedules={schedules}
            onSaved={() => {
              setCreating(false);
              onChanged();
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {positions.map((p) =>
          editingId === p.id ? (
            <li key={p.id}>
              <PositionForm
                initial={p}
                schedules={schedules}
                onSaved={() => {
                  setEditingId(null);
                  onChanged();
                }}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={p.id} className="flex items-center justify-between rounded-md bg-surface-page px-3 py-2">
              <div>
                <div className="text-sm font-medium text-ink">{p.name}</div>
                <div className="text-xs text-ink-muted">{p.schedule ? p.schedule.name : 'Sin horario asignado'}</div>
              </div>
              <button onClick={() => setEditingId(p.id)} className="text-ink-muted hover:text-ink" title="Editar cargo">
                <Pencil size={13} />
              </button>
            </li>
          ),
        )}
        {positions.length === 0 && !creating && <li className="text-sm text-ink-muted">Aun no hay cargos.</li>}
      </ul>
    </Card>
  );
}

export default function PositionsPage() {
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  function loadAll() {
    Promise.all([getSchedules(), getPositions()]).then(([s, p]) => {
      setSchedules(s);
      setPositions(p);
      setLoading(false);
    });
  }

  useEffect(() => {
    loadAll();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cargos y Horarios"
        subtitle="Crea un horario de entrada/salida, asignaselo a un cargo, y luego asignale ese cargo a cada empleado — asi se asocian los horarios automaticamente."
      />
      {loading ? (
        <p className="text-sm text-ink-muted">Cargando...</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SchedulesSection schedules={schedules} onChanged={loadAll} />
          <PositionsSection positions={positions} schedules={schedules} onChanged={loadAll} />
        </div>
      )}
    </div>
  );
}
