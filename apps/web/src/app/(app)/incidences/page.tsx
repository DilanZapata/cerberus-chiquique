'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, PartyPopper } from 'lucide-react';
import { Employee, PendingIncidence, createIncidence, getEmployees, getPendingIncidences, reviewIncidence } from '@/lib/api';
import { NOVELTY_LABELS } from '@/lib/novelty-labels';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const INCIDENCE_CODES = [
  'PERMISO_REMUNERADO',
  'PERMISO_NO_REMUNERADO',
  'PERMISO_SALIDA_TEMPORAL',
  'INCAPACIDAD_GENERAL',
  'INCAPACIDAD_ARL',
  'VACACIONES',
];

const inputClass =
  'rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

export default function IncidencesPage() {
  const [items, setItems] = useState<PendingIncidence[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [userId, setUserId] = useState('');
  const [code, setCode] = useState(INCIDENCE_CODES[0]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    getPendingIncidences()
      .then(setItems)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => {
    getEmployees()
      .then((all) => setEmployees(all.filter((e) => e.isActive)))
      .catch(() => null);
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createIncidence({ userId, code, startDate, endDate, notes: notes || undefined });
      setUserId('');
      setStartDate('');
      setEndDate('');
      setNotes('');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(id: string, status: 'APROBADA' | 'RECHAZADA') {
    setBusyId(id);
    try {
      await reviewIncidence(id, { status });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Permisos e Incapacidades" subtitle="Solicitud, aprobacion y rechazo de novedades de ausencia." />

      <Card className="p-5">
        <div className="text-sm font-medium text-ink">Nueva solicitud</div>
        <form onSubmit={handleCreate} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select required value={userId} onChange={(e) => setUserId(e.target.value)} className={`sm:col-span-2 ${inputClass}`}>
            <option value="">Selecciona un empleado</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName} ({emp.employeeCode})
              </option>
            ))}
          </select>
          <select value={code} onChange={(e) => setCode(e.target.value)} className={inputClass}>
            {INCIDENCE_CODES.map((c) => (
              <option key={c} value={c}>
                {NOVELTY_LABELS[c] ?? c}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Notas (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
          <input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
          <input required type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
          <Button disabled={submitting} className="sm:col-span-2">
            {submitting ? 'Enviando...' : 'Solicitar'}
          </Button>
        </form>
      </Card>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-ink-muted">Cargando...</p>}
      {!loading && !error && items.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <PartyPopper className="text-emerald-500" size={28} />
          <p className="text-sm text-ink-secondary">No hay solicitudes pendientes.</p>
        </Card>
      )}

      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
            >
              <Card className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                    <FileText size={18} />
                  </div>
                  <div>
                    <div className="font-medium text-ink">{item.user.fullName}</div>
                    <div className="text-xs text-ink-muted">
                      {item.user.employeeCode} · {NOVELTY_LABELS[item.code] ?? item.code} · {item.startDate.slice(0, 10)} a{' '}
                      {item.endDate.slice(0, 10)}
                    </div>
                    {item.notes && <div className="mt-1 text-xs text-ink-muted">{item.notes}</div>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="danger" disabled={busyId === item.id} onClick={() => decide(item.id, 'RECHAZADA')}>
                    Rechazar
                  </Button>
                  <Button variant="success" disabled={busyId === item.id} onClick={() => decide(item.id, 'APROBADA')}>
                    Aprobar
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
