'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarCheck2, PartyPopper } from 'lucide-react';
import { PendingRestCredit, getPendingRestCredits, takeRestCredit } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function RestCreditsPage() {
  const [items, setItems] = useState<PendingRestCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getPendingRestCredits()
      .then(setItems)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function take(id: string) {
    const takenDate = prompt('Fecha en que se tomara el descanso (YYYY-MM-DD):');
    if (!takenDate) return;
    setBusyId(id);
    try {
      await takeRestCredit(id, takenDate);
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
        title="Descanso Compensatorio"
        subtitle="Creditos generados cuando el trabajo dominical/festivo de un empleado se vuelve habitual (Art. 180 CST: 3ra vez o mas en el mes)."
      />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-ink-muted">Cargando...</p>}
      {!loading && !error && items.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <PartyPopper className="text-emerald-500" size={28} />
          <p className="text-sm text-ink-secondary">No hay creditos de descanso compensatorio pendientes.</p>
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
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <CalendarCheck2 size={18} />
                  </div>
                  <div>
                    <div className="font-medium text-ink">{item.user.fullName}</div>
                    <div className="text-xs text-ink-muted">
                      {item.user.employeeCode} · Ganado por trabajar el {item.earnedForDate.slice(0, 10)}
                    </div>
                    {item.notes && <div className="mt-1 text-xs text-ink-muted">{item.notes}</div>}
                  </div>
                </div>
                <Button disabled={busyId === item.id} onClick={() => take(item.id)}>
                  Marcar tomado
                </Button>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
