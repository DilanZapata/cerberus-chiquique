'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Milk, AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import { Employee, MilkingRoutineResult, getEmployees, smartGenerateMilkingRoutine } from '@/lib/api';
import { getCompanyId } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const inputClass =
  'rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-ink-secondary';

const ROLE_STYLES: Record<string, string> = {
  ordenador: 'bg-series-blue/15 text-series-blue',
  vaquero: 'bg-series-green/15 text-series-green',
  corto: 'bg-series-yellow/20 text-[#8a6600]',
  descanso: 'bg-surface-page text-ink-muted',
};

const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function dayLabelFor(anchorDate: string, dayOffset: number): string {
  if (!anchorDate) return `Dia ${dayOffset}`;
  const d = new Date(`${anchorDate}T00:00:00`);
  d.setDate(d.getDate() + dayOffset);
  return `${WEEKDAY_LABELS[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

export default function MilkingRoutinePage() {
  const [companyId, setCompanyId] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState('');
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [comodinWorkerId, setComodinWorkerId] = useState('');
  const [stationsCount, setStationsCount] = useState(1);
  const [vaqueroWorkerIds, setVaqueroWorkerIds] = useState<string[]>([]);
  const [anchorDate, setAnchorDate] = useState('');
  const [morningStart, setMorningStart] = useState('04:00');
  const [morningEnd, setMorningEnd] = useState('08:00');
  const [eveningStart, setEveningStart] = useState('16:00');
  const [eveningEnd, setEveningEnd] = useState('20:00');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MilkingRoutineResult | null>(null);

  useEffect(() => {
    const id = getCompanyId();
    if (id) setCompanyId(id);
    getEmployees()
      .then(setEmployees)
      .catch(() => {});
  }, []);

  function toggleWorker(id: string) {
    setSelectedWorkerIds((prev) => (prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]));
    if (comodinWorkerId === id) setComodinWorkerId('');
    if (vaqueroWorkerIds.includes(id)) setVaqueroWorkerIds((prev) => prev.filter((w) => w !== id));
  }

  function toggleVaquero(id: string) {
    setVaqueroWorkerIds((prev) => {
      if (prev.includes(id)) return prev.filter((w) => w !== id);
      if (prev.length >= stationsCount) return prev; // uno fijo por ordeño, no mas
      return [...prev, id];
    });
  }

  async function generate(fullDayWorkerIds?: string[], reducedRestWorkerIds?: string[]) {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const plan = await smartGenerateMilkingRoutine(companyId, {
        name,
        workerIds: selectedWorkerIds,
        comodinWorkerId: comodinWorkerId || undefined,
        stationsCount,
        fullDayWorkerIds,
        reducedRestWorkerIds,
        vaqueroWorkerIds: vaqueroWorkerIds.length > 0 ? vaqueroWorkerIds : undefined,
        anchorDate,
        morningStart,
        morningEnd,
        eveningStart,
        eveningEnd,
      });
      setResult(plan);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    generate();
  }

  function handleApplySuggestion() {
    if (result?.suggestedFullDayWorkerIds) {
      generate(result.suggestedFullDayWorkerIds, result.suggestedReducedRestWorkerIds);
    }
  }

  const employeeName = (id: string) => employees.find((e) => e.id === id)?.fullName ?? id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rutina de Ordeño"
        subtitle="Arma automaticamente la rotacion de ordeñadores y vaquero, respetando el ciclo de descanso quincenal de la jornada especial de ordeño."
      />

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Milk size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">Generador de rutina</div>
            <div className="text-xs text-ink-muted">
              Cada dia siempre necesita 2 ordeñadores + 1 vaquero. Cada trabajador tiene un dia corto (4h) seguido de un
              dia libre completo cada semana, y cada dos semanas ese mismo par de dias pasa a ser 2 dias libres
              completos. Si agregas un comodin, el cubre lo que haga falta y no descansa nunca.
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Nombre de la rutina</label>
            <input
              required
              placeholder="ej. Ordeño Finca Principal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`mt-1 w-full ${inputClass}`}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Trabajadores ({selectedWorkerIds.length} seleccionados)</label>
            <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line-axis bg-surface-card p-2">
              {employees.length === 0 && (
                <p className="p-2 text-sm text-ink-muted">No hay empleados activos. Crea empleados primero en la seccion Empleados.</p>
              )}
              {employees.map((emp) => (
                <label key={emp.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-secondary hover:bg-surface-page">
                  <input type="checkbox" checked={selectedWorkerIds.includes(emp.id)} onChange={() => toggleWorker(emp.id)} />
                  {emp.fullName} <span className="text-xs text-ink-muted">({emp.employeeCode})</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className={labelClass}>Cantidad de ordeños (estaciones simultaneas)</label>
            <input
              required
              type="number"
              min={1}
              max={10}
              value={stationsCount}
              onChange={(e) => setStationsCount(Number(e.target.value))}
              className={`mt-1 w-full ${inputClass}`}
            />
            <p className="mt-1 text-xs text-ink-muted">
              Cada ordeño necesita 2 ordeñadores + 1 vaquero. Con {stationsCount} ordeño(s) se necesitan {stationsCount * 3} personas
              disponibles cada dia.
            </p>
          </div>
          <div>
            <label className={labelClass}>Comodin (opcional, siempre disponible, cubre ordeño o vaqueria)</label>
            <select value={comodinWorkerId} onChange={(e) => setComodinWorkerId(e.target.value)} className={`mt-1 w-full ${inputClass}`}>
              <option value="">Ninguno</option>
              {employees
                .filter((e) => selectedWorkerIds.includes(e.id))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} ({e.employeeCode})
                  </option>
                ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>
              Vaqueros fijos ({vaqueroWorkerIds.length}/{stationsCount})
            </label>
            <p className="mt-0.5 text-xs text-ink-muted">
              Elige hasta {stationsCount} trabajador(es) que sean siempre el vaquero (uno por ordeño). Los dias que
              les toque descansar o dia corto, el sistema asigna un reemplazo automaticamente entre los disponibles.
            </p>
            <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-line-axis bg-surface-card p-2">
              {employees
                .filter((e) => selectedWorkerIds.includes(e.id) && e.id !== comodinWorkerId)
                .map((e) => (
                  <label key={e.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-secondary hover:bg-surface-page">
                    <input
                      type="checkbox"
                      checked={vaqueroWorkerIds.includes(e.id)}
                      disabled={!vaqueroWorkerIds.includes(e.id) && vaqueroWorkerIds.length >= stationsCount}
                      onChange={() => toggleVaquero(e.id)}
                    />
                    {e.fullName} <span className="text-xs text-ink-muted">({e.employeeCode})</span>
                  </label>
                ))}
            </div>
          </div>

          <div>
            <label className={labelClass}>Ordeño mañana desde</label>
            <input required type="time" value={morningStart} onChange={(e) => setMorningStart(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass}>Ordeño mañana hasta</label>
            <input required type="time" value={morningEnd} onChange={(e) => setMorningEnd(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass}>Ordeño tarde desde</label>
            <input required type="time" value={eveningStart} onChange={(e) => setEveningStart(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass}>Ordeño tarde hasta</label>
            <input required type="time" value={eveningEnd} onChange={(e) => setEveningEnd(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Fecha de inicio del ciclo</label>
            <input required type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
          </div>

          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 sm:col-span-2">{error}</p>}

          <Button disabled={submitting || selectedWorkerIds.length === 0 || !companyId} className="sm:col-span-2">
            <Sparkles size={16} />
            {submitting ? 'Calculando la rotacion...' : 'Generar rutina automaticamente'}
          </Button>
        </form>

        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-6 border-t border-line-hair pt-5">
                {!result.feasible ? (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold">Trabajadores insuficientes</div>
                      <p className="mt-1">{result.warnings.join(' ')}</p>
                      {result.minimumWorkersNeeded && (
                        <p className="mt-2 font-medium">
                          Sugerencia: agrega al menos {result.minimumWorkersNeeded - selectedWorkerIds.length + (comodinWorkerId ? 1 : 0)} trabajador(es)
                          más al equipo (total minimo: {result.minimumWorkersNeeded}{comodinWorkerId ? ' + el comodin' : ''}).
                        </p>
                      )}
                      {result.suggestedFullDayWorkerIds && result.suggestedFullDayWorkerIds.length > 0 ? (
                        <div className="mt-3 rounded-lg bg-amber-100/60 p-3">
                          <p>
                            Alternativa sin contratar a nadie: si estos trabajadores renuncian a su dia corto (trabajan
                            jornada completa ese dia tambien):{' '}
                            <span className="font-medium">{result.suggestedFullDayWorkerNames?.join(', ')}</span>.
                          </p>
                          {result.suggestedReducedRestWorkerNames && result.suggestedReducedRestWorkerNames.length > 0 && (
                            <p className="mt-2">
                              Y ADEMAS, estos tambien renuncian a su segundo descanso de la semana B (quedan con solo 1
                              descanso esa semana en vez de 2):{' '}
                              <span className="font-medium">{result.suggestedReducedRestWorkerNames.join(', ')}</span>.
                            </p>
                          )}
                          <Button variant="secondary" className="mt-2" onClick={handleApplySuggestion} disabled={submitting}>
                            Aplicar esta alternativa y generar
                          </Button>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-amber-700">
                          Ya probe quitandole el dia corto Y el segundo descanso de la semana B a todos los del equipo
                          actual (el maximo posible) y aun asi no alcanza — con este equipo no hay forma de cumplir el
                          minimo diario, hace falta mas gente.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium text-ink">
                      <CheckCircle2 size={16} className="text-emerald-500" />
                      Rutina generada — ciclo de {result.cycleLengthDays} dias, {result.workers?.length} trabajador(es)
                    </div>

                    <div className="mt-3 flex flex-wrap gap-3 text-xs">
                      <span className={`rounded-full px-3 py-1 font-medium ${ROLE_STYLES.ordenador}`}>Ordeñador</span>
                      <span className={`rounded-full px-3 py-1 font-medium ${ROLE_STYLES.vaquero}`}>Vaquero</span>
                      <span className={`rounded-full px-3 py-1 font-medium ${ROLE_STYLES.corto}`}>Dia corto (4h)</span>
                      <span className={`rounded-full px-3 py-1 font-medium ${ROLE_STYLES.descanso}`}>Descanso</span>
                    </div>

                    <div className="mt-4 overflow-x-auto rounded-lg border border-line-hair">
                      <table className="min-w-full text-sm">
                        <thead className="bg-surface-page">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-ink-secondary">Trabajador</th>
                            {Array.from({ length: result.cycleLengthDays ?? 14 }, (_, d) => (
                              <th key={d} className="whitespace-nowrap px-2 py-2 text-center font-semibold capitalize text-ink-secondary">
                                {dayLabelFor(anchorDate, d)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line-hair">
                          {result.workers?.map((w) => (
                            <tr key={w.userId}>
                              <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                                {w.fullName}
                                {w.role === 'COMODIN' && <span className="ml-1 text-xs text-ink-muted">(comodin)</span>}
                              </td>
                              {result.days?.map((day) => {
                                let label = '';
                                let style = ROLE_STYLES.descanso;
                                const stationAsOrdenador = day.stations.find((s) => s.ordenadores.includes(w.fullName));
                                const stationAsVaquero = day.stations.find((s) => s.vaquero === w.fullName);
                                const multi = (result.stationsCount ?? 1) > 1;
                                if (stationAsOrdenador) {
                                  label = multi ? `Ordeñador ${stationAsOrdenador.stationIndex + 1}` : 'Ordeñador';
                                  style = ROLE_STYLES.ordenador;
                                } else if (stationAsVaquero) {
                                  const base = multi ? `Vaquero ${stationAsVaquero.stationIndex + 1}` : 'Vaquero';
                                  label = stationAsVaquero.isVaqueroSubstitute ? `${base} (reemplazo)` : base;
                                  style = ROLE_STYLES.vaquero;
                                } else if (day.workersOnShortDay.includes(w.fullName)) {
                                  label = 'Corto';
                                  style = ROLE_STYLES.corto;
                                } else if (day.workersResting.includes(w.fullName)) {
                                  label = 'Descanso';
                                  style = ROLE_STYLES.descanso;
                                }
                                return (
                                  <td key={day.dayOffset} className="px-1.5 py-1.5 text-center">
                                    <span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${style}`}>{label}</span>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-3 text-xs text-ink-muted">
                      La rutina ya quedo asignada a cada trabajador y se generaron los turnos concretos para las
                      proximas semanas (se repite automaticamente cada 14 dias).
                    </p>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}
