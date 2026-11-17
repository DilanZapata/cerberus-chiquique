'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock3, PartyPopper } from 'lucide-react';
import {
  Employee,
  OvertimeAuthorizationRow,
  PendingOvertime,
  authorizeOvertime,
  getEmployees,
  getOvertimeAuthorizations,
  getPendingOvertime,
  reviewOvertime,
} from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const inputClass =
  'mt-1 w-full rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-xs font-medium text-ink-secondary';

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hoursLabel(hours: number): string {
  return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
}

/** Medias horas entre 0.5 y `max`, para elegir cuanto aprobar de un pendiente. */
function halfHourSteps(max: number): number[] {
  const steps: number[] = [];
  for (let h = 0.5; h <= max + 1e-9; h += 0.5) steps.push(Math.round(h * 2) / 2);
  return steps;
}

export default function OvertimeApprovalPage() {
  const [items, setItems] = useState<PendingOvertime[]>([]);
  const [authorizations, setAuthorizations] = useState<OvertimeAuthorizationRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Horas a aprobar elegidas por solicitud (por defecto, todo lo pendiente). */
  const [partial, setPartial] = useState<Record<string, number>>({});

  const [formUserId, setFormUserId] = useState('');
  const [formDate, setFormDate] = useState(localDate());
  const [formHours, setFormHours] = useState('1');
  const [formNotes, setFormNotes] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formMessage, setFormMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Ultimos 30 dias + proximos 30 (las autorizaciones pueden darse por adelantado).
  const range = useMemo(() => ({ from: localDate(-30), to: localDate(30) }), []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [pending, given] = await Promise.all([
        getPendingOvertime(),
        getOvertimeAuthorizations(range.from, range.to),
      ]);
      setItems(pending);
      setAuthorizations(given);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    getEmployees()
      .then((list) => {
        const active = list.filter((e) => e.isActive).sort((a, b) => a.fullName.localeCompare(b.fullName));
        setEmployees(active);
        setFormUserId((current) => current || active[0]?.id || '');
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(item: PendingOvertime, status: 'APROBADA' | 'RECHAZADA') {
    setBusyId(item.id);
    setError(null);
    try {
      const pending = Number(item.requestedHours);
      const chosen = partial[item.id] ?? pending;
      await reviewOvertime(item.id, status === 'APROBADA' && chosen < pending ? { status, approvedHours: chosen } : { status });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function submitAuthorization(event: FormEvent) {
    event.preventDefault();
    if (!formUserId) return;
    setFormBusy(true);
    setFormMessage(null);
    try {
      const result = await authorizeOvertime({
        userId: formUserId,
        workDate: formDate,
        hours: Number(formHours),
        notes: formNotes.trim() || undefined,
      });
      setFormMessage({
        ok: true,
        text:
          result.workedHours > 0
            ? `Listo: ${hoursLabel(result.authorizedHours)} autorizadas a ${result.fullName}. Ese dia trabajo ${hoursLabel(result.workedHours)} extra: se pagan ${result.approvedHours}${result.pendingHours > 0 ? ` y quedan ${result.pendingHours} pendientes` : ''}.`
            : `Listo: ${hoursLabel(result.authorizedHours)} autorizadas a ${result.fullName}. Se pagara solo lo que realmente trabaje, hasta ese tope.`,
      });
      setFormNotes('');
      await load();
    } catch (err) {
      setFormMessage({ ok: false, text: (err as Error).message });
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Horas Extra"
        subtitle="Autoriza horas extra por persona y dia, y decide sobre las que se trabajaron sin autorizacion."
      />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card className="p-5">
        <div className="text-sm font-semibold text-ink">Autorizar horas extra</div>
        <p className="mt-0.5 text-xs text-ink-secondary">
          Se paga lo menor entre lo autorizado y lo trabajado. Si la persona trabaja mas de lo autorizado, el resto
          queda pendiente y te llega un correo para que lo decidas.
        </p>
        <form onSubmit={submitAuthorization} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_2fr_auto] lg:items-end">
          <div>
            <label className={labelClass}>Empleado</label>
            <select value={formUserId} onChange={(e) => setFormUserId(e.target.value)} className={inputClass} required>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName} — {e.nationalId}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Dia</label>
            <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className={inputClass} required />
          </div>
          <div>
            <label className={labelClass}>Horas autorizadas</label>
            <input
              type="number"
              min={0}
              max={16}
              step={0.5}
              value={formHours}
              onChange={(e) => setFormHours(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Motivo (opcional)</label>
            <input
              type="text"
              maxLength={500}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Ej. cierre de mes"
              className={inputClass}
            />
          </div>
          <Button type="submit" variant="success" disabled={formBusy || !formUserId}>
            {formBusy ? 'Guardando...' : 'Autorizar'}
          </Button>
        </form>
        {formMessage && (
          <p className={`mt-3 rounded-lg p-3 text-sm ${formMessage.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
            {formMessage.text}
          </p>
        )}
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Pendientes por decidir</h2>
        {loading && <p className="text-sm text-ink-muted">Cargando...</p>}

        {!loading && !error && items.length === 0 && (
          <Card className="flex flex-col items-center gap-2 p-8 text-center">
            <PartyPopper className="text-emerald-500" size={28} />
            <p className="text-sm text-ink-secondary">No hay horas extra pendientes de autorizacion.</p>
          </Card>
        )}

        <AnimatePresence initial={false}>
          {items.map((item) => {
            const pending = Number(item.requestedHours);
            const chosen = partial[item.id] ?? pending;
            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
              >
                <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                      <Clock3 size={18} />
                    </div>
                    <div>
                      <div className="font-medium text-ink">{item.novelty.user.fullName}</div>
                      <div className="text-xs text-ink-muted">
                        {item.novelty.user.employeeCode} · {item.novelty.workDate.slice(0, 10)}
                      </div>
                      <div className="mt-1 text-sm text-ink-secondary">
                        Trabajo <span className="font-semibold text-ink">{hoursLabel(item.workedHours)}</span> extra ·{' '}
                        {item.authorizedHours > 0 ? (
                          <>
                            autorizadas <span className="font-semibold text-ink">{item.authorizedHours}</span>
                            {item.authorizedByName ? ` por ${item.authorizedByName}` : ''}
                          </>
                        ) : (
                          'sin autorizacion previa'
                        )}{' '}
                        · pendientes <span className="font-semibold text-amber-700">{pending}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
                      Aprobar
                      <select
                        value={chosen}
                        onChange={(e) => setPartial((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))}
                        className="rounded-lg border border-line-axis bg-surface-card px-2 py-1.5 text-sm text-ink"
                        aria-label="Horas a aprobar"
                      >
                        {halfHourSteps(pending).map((h) => (
                          <option key={h} value={h}>
                            {h} h{h === pending ? ' (todo)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button variant="danger" disabled={busyId === item.id} onClick={() => decide(item, 'RECHAZADA')}>
                      Rechazar
                    </Button>
                    <Button variant="success" disabled={busyId === item.id} onClick={() => decide(item, 'APROBADA')}>
                      Aprobar
                    </Button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Autorizaciones dadas (ultimos 30 dias y proximas)</h2>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line-hair text-left text-xs text-ink-muted">
                <th className="px-4 py-2 font-medium">Dia</th>
                <th className="px-4 py-2 font-medium">Empleado</th>
                <th className="px-4 py-2 text-right font-medium">Autorizadas</th>
                <th className="px-4 py-2 text-right font-medium">Trabajadas</th>
                <th className="px-4 py-2 text-right font-medium">Se pagan</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Autorizo</th>
              </tr>
            </thead>
            <tbody>
              {authorizations.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-muted">
                    Aun no hay autorizaciones en este periodo.
                  </td>
                </tr>
              )}
              {authorizations.map((row) => (
                <tr key={`${row.userId}-${row.workDate}`} className="border-b border-line-hair last:border-0">
                  <td className="px-4 py-2 tabular-nums text-ink">{row.workDate}</td>
                  <td className="px-4 py-2">
                    <div className="text-ink">{row.fullName}</div>
                    {row.notes && <div className="text-xs text-ink-muted">{row.notes}</div>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">{row.authorizedHours}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">{row.workedHours}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink">{row.approvedHours}</td>
                  <td className="px-4 py-2">
                    {row.pendingHours > 0 ? (
                      <Badge tone="warning">{row.pendingHours} h pendientes</Badge>
                    ) : row.rejectedHours > 0 ? (
                      <Badge tone="critical">{row.rejectedHours} h rechazadas</Badge>
                    ) : row.workedHours === 0 ? (
                      <Badge tone="neutral">Sin trabajar aun</Badge>
                    ) : (
                      <Badge tone="good">Al dia</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-secondary">{row.authorizedByName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
