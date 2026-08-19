'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock3, PartyPopper } from 'lucide-react';
import { PendingOvertime, getPendingOvertime, reviewOvertime } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function OvertimeApprovalPage() {
  const [items, setItems] = useState<PendingOvertime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getPendingOvertime()
      .then(setItems)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function decide(id: string, status: 'APROBADA' | 'RECHAZADA') {
    setBusyId(id);
    try {
      await reviewOvertime(id, { status });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aprobacion de Horas Extra"
        subtitle="Horas extra detectadas por el motor de calculo sin autorizacion previa."
      />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-ink-muted">Cargando...</p>}

      {!loading && !error && items.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <PartyPopper className="text-emerald-500" size={28} />
          <p className="text-sm text-ink-secondary">No hay horas extra pendientes de autorizacion.</p>
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
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                    <Clock3 size={18} />
                  </div>
                  <div>
                    <div className="font-medium text-ink">{item.novelty.user.fullName}</div>
                    <div className="text-xs text-ink-muted">
                      {item.novelty.user.employeeCode} · {item.novelty.workDate.slice(0, 10)}
                    </div>
                    <div className="mt-1 text-sm text-ink-secondary">
                      Solicita <span className="font-semibold text-ink">{item.requestedHours} h</span> de hora extra
                    </div>
                    {item.novelty.notes && <div className="mt-1 text-xs text-ink-muted">{item.novelty.notes}</div>}
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
