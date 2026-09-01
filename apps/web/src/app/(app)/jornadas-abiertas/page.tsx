'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Clock3, PartyPopper } from 'lucide-react';
import { JornadaAbierta, getJornadasAbiertas, reviewJornada } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const ESTADO_LABELS: Record<JornadaAbierta['estado'], string> = {
  SIN_HORARIO: 'Sin horario asignado: marco entrada pero el sistema no tiene un horario para evaluar su salida',
  PENDIENTE_CIERRE: 'Ya paso su hora de salida programada; el cierre automatico la evaluara en el proximo ciclo',
  VENCIDA_CIERRE_AUTOMATICO: 'Vencida hace rato sin salida; deberia cerrarse sola en el proximo ciclo del cierre automatico',
  CERRADA_PENDIENTE_REVISION: 'Cerrada automaticamente por el sistema: pendiente de que un supervisor la revise',
};

function itemKey(item: JornadaAbierta) {
  return item.noveltyId ?? `${item.userId}-${item.workDate}`;
}

export default function JornadasAbiertasPage() {
  const [items, setItems] = useState<JornadaAbierta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getJornadasAbiertas()
      .then(setItems)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function decide(item: JornadaAbierta, status: 'APROBADA' | 'RECHAZADA') {
    if (!item.noveltyId) return;
    const key = itemKey(item);
    setBusyKey(key);
    try {
      await reviewJornada(item.noveltyId, { status });
      setItems((prev) => prev.filter((i) => itemKey(i) !== key));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jornadas Abiertas"
        subtitle="Jornadas de hoy que quedaron sin marcar salida: vencidas pendientes de cierre automatico, o ya cerradas por el sistema y pendientes de revision."
      />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-ink-muted">Cargando...</p>}

      {!loading && !error && items.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <PartyPopper className="text-emerald-500" size={28} />
          <p className="text-sm text-ink-secondary">No hay jornadas abiertas ni pendientes de revision hoy.</p>
        </Card>
      )}

      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const key = itemKey(item);
            const isReviewable = item.kind === 'CERRADA_PENDIENTE_REVISION';
            return (
              <motion.div
                key={key}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
              >
                <Card className="flex items-center justify-between gap-4 p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                        isReviewable ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {isReviewable ? <AlertTriangle size={18} /> : <Clock3 size={18} />}
                    </div>
                    <div>
                      <div className="font-medium text-ink">{item.fullName}</div>
                      <div className="text-xs text-ink-muted">
                        {item.employeeCode} · {item.workDate}
                        {item.department ? ` · ${item.department}` : ''}
                      </div>
                      <div className="mt-1 text-sm text-ink-secondary">
                        {item.kind === 'ABIERTA' ? (
                          <>
                            Entro <span className="font-semibold text-ink">{item.checkIn}</span>
                            {item.plannedExit && <> · salida programada {item.plannedExit}</>}
                          </>
                        ) : (
                          <>
                            Salida asignada automaticamente: <span className="font-semibold text-ink">{item.autoClosedExit}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-ink-muted">{ESTADO_LABELS[item.estado]}</div>
                    </div>
                  </div>
                  {isReviewable && (
                    <div className="flex shrink-0 gap-2">
                      <Button variant="danger" disabled={busyKey === key} onClick={() => decide(item, 'RECHAZADA')}>
                        Rechazar
                      </Button>
                      <Button variant="success" disabled={busyKey === key} onClick={() => decide(item, 'APROBADA')}>
                        Aprobar
                      </Button>
                    </div>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
