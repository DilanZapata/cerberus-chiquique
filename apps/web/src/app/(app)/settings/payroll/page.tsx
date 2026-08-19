'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Plus, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import {
  CreatePayrollConfigVersionBody,
  PayrollConfigVersion,
  PayrollSettings,
  createPayrollConfigVersion,
  getPayrollConfigVersions,
  getPayrollSettings,
  updatePayrollConfigVersion,
  updatePayrollSettings,
} from '@/lib/api';
import { getCompanyId } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LiquidToggle } from '@/components/ui/LiquidToggle';

const inputClass =
  'mt-1 w-full rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-xs font-medium text-ink-secondary';

const DEFAULTS: CreatePayrollConfigVersionBody = {
  effectiveFrom: '',
  dayStartTime: '06:00',
  nightStartTime: '19:00',
  maxWeeklyHours: 42,
  maxDailyOrdinaryHours: 8,
  maxDailyOvertimeHours: 2,
  maxWeeklyOvertimeHours: 12,
  dominicalOcasionalMaxPerMonth: 2,
  pctRecargoNocturno: 0.35,
  pctDominicalFestivo: 0.9,
  pctDominicalFestivoNocturno: 1.25,
  pctHoraExtraDiurna: 0.25,
  pctHoraExtraNocturna: 0.75,
  pctHoraExtraFestivaDiurna: 1.15,
  pctHoraExtraFestivaNocturna: 1.65,
  notes: '',
};

function fromVersion(v: PayrollConfigVersion): CreatePayrollConfigVersionBody {
  return {
    effectiveFrom: v.effectiveFrom.slice(0, 10),
    dayStartTime: v.dayStartTime.slice(11, 16),
    nightStartTime: v.nightStartTime.slice(11, 16),
    maxWeeklyHours: Number(v.maxWeeklyHours),
    maxDailyOrdinaryHours: Number(v.maxDailyOrdinaryHours),
    maxDailyOvertimeHours: Number(v.maxDailyOvertimeHours),
    maxWeeklyOvertimeHours: Number(v.maxWeeklyOvertimeHours),
    dominicalOcasionalMaxPerMonth: v.dominicalOcasionalMaxPerMonth,
    pctRecargoNocturno: Number(v.pctRecargoNocturno),
    pctDominicalFestivo: Number(v.pctDominicalFestivo),
    pctDominicalFestivoNocturno: Number(v.pctDominicalFestivoNocturno),
    pctHoraExtraDiurna: Number(v.pctHoraExtraDiurna),
    pctHoraExtraNocturna: Number(v.pctHoraExtraNocturna),
    pctHoraExtraFestivaDiurna: Number(v.pctHoraExtraFestivaDiurna),
    pctHoraExtraFestivaNocturna: Number(v.pctHoraExtraFestivaNocturna),
    notes: v.notes ?? '',
  };
}

function VersionForm({
  companyId,
  initial,
  onSaved,
  onCancel,
}: {
  companyId: string;
  initial?: PayrollConfigVersion;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<CreatePayrollConfigVersionBody>(initial ? fromVersion(initial) : DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CreatePayrollConfigVersionBody>(key: K, value: CreatePayrollConfigVersionBody[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, notes: form.notes || undefined };
      if (initial) {
        await updatePayrollConfigVersion(companyId, initial.id, body);
      } else {
        await createPayrollConfigVersion(companyId, body);
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-ink">{initial ? 'Editar version de parametros' : 'Nueva version de parametros'}</div>
        <button onClick={onCancel} className="text-ink-muted hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <label className={labelClass}>Vigente desde</label>
          <input required type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Jornada diurna desde</label>
          <input required type="time" value={form.dayStartTime} onChange={(e) => set('dayStartTime', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Jornada nocturna desde</label>
          <input required type="time" value={form.nightStartTime} onChange={(e) => set('nightStartTime', e.target.value)} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Max. horas semanales</label>
          <input
            required
            type="number"
            min={1}
            value={form.maxWeeklyHours}
            onChange={(e) => set('maxWeeklyHours', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Max. horas ordinarias/dia</label>
          <input
            required
            type="number"
            min={1}
            value={form.maxDailyOrdinaryHours}
            onChange={(e) => set('maxDailyOrdinaryHours', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Tope extra/dia (horas)</label>
          <input
            required
            type="number"
            min={0}
            step={0.5}
            value={form.maxDailyOvertimeHours}
            onChange={(e) => set('maxDailyOvertimeHours', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Tope extra/semana (horas)</label>
          <input
            required
            type="number"
            min={0}
            step={0.5}
            value={form.maxWeeklyOvertimeHours}
            onChange={(e) => set('maxWeeklyOvertimeHours', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Dominicales ocasionales/mes</label>
          <input
            required
            type="number"
            min={0}
            value={form.dominicalOcasionalMaxPerMonth}
            onChange={(e) => set('dominicalOcasionalMaxPerMonth', Number(e.target.value))}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Recargo nocturno (%)</label>
          <input
            required
            type="number"
            min={0}
            step={0.01}
            value={form.pctRecargoNocturno}
            onChange={(e) => set('pctRecargoNocturno', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Recargo dominical/festivo (%)</label>
          <input
            required
            type="number"
            min={0}
            step={0.01}
            value={form.pctDominicalFestivo}
            onChange={(e) => set('pctDominicalFestivo', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Recargo dominical/festivo nocturno (%)</label>
          <input
            required
            type="number"
            min={0}
            step={0.01}
            value={form.pctDominicalFestivoNocturno}
            onChange={(e) => set('pctDominicalFestivoNocturno', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Hora extra diurna (%)</label>
          <input
            required
            type="number"
            min={0}
            step={0.01}
            value={form.pctHoraExtraDiurna}
            onChange={(e) => set('pctHoraExtraDiurna', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Hora extra nocturna (%)</label>
          <input
            required
            type="number"
            min={0}
            step={0.01}
            value={form.pctHoraExtraNocturna}
            onChange={(e) => set('pctHoraExtraNocturna', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Hora extra festiva diurna (%)</label>
          <input
            required
            type="number"
            min={0}
            step={0.01}
            value={form.pctHoraExtraFestivaDiurna}
            onChange={(e) => set('pctHoraExtraFestivaDiurna', Number(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Hora extra festiva nocturna (%)</label>
          <input
            required
            type="number"
            min={0}
            step={0.01}
            value={form.pctHoraExtraFestivaNocturna}
            onChange={(e) => set('pctHoraExtraFestivaNocturna', Number(e.target.value))}
            className={inputClass}
          />
        </div>

        <div className="col-span-2 sm:col-span-3">
          <label className={labelClass}>Notas (opcional)</label>
          <input
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="ej. Ajuste segun Ley 2466 de 2025"
            className={inputClass}
          />
        </div>

        {error && <p className="col-span-2 text-xs text-red-700 sm:col-span-3">{error}</p>}

        <div className="col-span-2 flex gap-2 sm:col-span-3">
          <Button disabled={saving} type="submit" className="flex-1">
            {saving ? 'Guardando...' : 'Guardar version'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function OvertimeAuthorizationCard({ companyId }: { companyId: string }) {
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPayrollSettings(companyId)
      .then(setSettings)
      .catch((err) => setError(err.message));
  }, [companyId]);

  async function handleToggle(next: boolean) {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, overtimeRequiresPreauthorization: next });
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePayrollSettings(companyId, { overtimeRequiresPreauthorization: next });
      setSettings(updated);
    } catch (err) {
      setSettings(previous);
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* manchas de color desenfocadas detras del vidrio */}
      <div aria-hidden className="pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full bg-brand-400/40 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-16 -right-10 h-40 w-40 rounded-full bg-series-violet/30 blur-3xl" />

      <div className="relative flex flex-col gap-4 rounded-2xl border border-white/50 bg-white/30 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_8px_30px_rgba(11,11,11,0.10)] backdrop-blur-2xl sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/60 bg-white/40 text-brand-700 shadow-inner backdrop-blur-md">
            <ShieldCheck size={16} />
          </span>
          <div>
            <div className="text-sm font-semibold text-ink">Autorizacion obligatoria de horas extra</div>
            <p className="mt-0.5 max-w-md text-xs text-ink-secondary">
              Cuando esta activo, ninguna hora extra se paga automaticamente: toda queda en estado{' '}
              <span className="font-medium">Pendiente</span> hasta que un supervisor/HR/admin la apruebe en{' '}
              <span className="font-medium">Horas extra</span>.
            </p>
            {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 pl-12 sm:pl-0">
          {settings ? (
            <>
              <span className="text-xs font-medium text-ink-secondary">
                {settings.overtimeRequiresPreauthorization ? 'Activo' : 'Inactivo'}
              </span>
              <LiquidToggle
                checked={settings.overtimeRequiresPreauthorization}
                onChange={handleToggle}
                disabled={saving}
                label="Autorizacion obligatoria de horas extra"
              />
            </>
          ) : (
            <span className="text-xs text-ink-muted">Cargando...</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PayrollConfigPage() {
  const [versions, setVersions] = useState<PayrollConfigVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const companyId = getCompanyId();

  function load() {
    if (!companyId) {
      setError('No se encontro la empresa de la sesion actual.');
      setLoading(false);
      return;
    }
    setLoading(true);
    getPayrollConfigVersions(companyId)
      .then(setVersions)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const todayISO = new Date().toISOString().slice(0, 10);
  const currentVersionId = versions
    .filter((v) => v.effectiveFrom.slice(0, 10) <= todayISO)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0]?.id;

  const editingVersion = versions.find((v) => v.id === editingId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parametros de Nomina"
        subtitle="Vigencias legales (Ley 2466 de 2025 y sucesoras): recargo dominical, jornada nocturna y topes de horas extra cambian con el tiempo, cada version aplica desde su fecha en adelante."
        actions={
          !creating &&
          !editingId &&
          companyId && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Nueva version
            </Button>
          )
        }
      />

      {companyId && <OvertimeAuthorizationCard companyId={companyId} />}

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-ink-muted">Cargando...</p>}

      {creating && companyId && (
        <VersionForm
          companyId={companyId}
          onSaved={() => {
            setCreating(false);
            load();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {editingVersion && companyId && (
        <VersionForm
          companyId={companyId}
          initial={editingVersion}
          onSaved={() => {
            setEditingId(null);
            load();
          }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {!loading && versions.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line-hair text-sm">
              <thead className="bg-surface-page">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Vigente desde</th>
                  <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Jornada diurna/nocturna</th>
                  <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Max. semanal</th>
                  <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Recargo dominical</th>
                  <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Extra diurna</th>
                  <th className="px-4 py-2 text-left font-semibold text-ink-secondary">Notas</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-hair">
                {versions.map((v) => (
                  <tr key={v.id} className={v.id === currentVersionId ? 'bg-brand-50/40' : undefined}>
                    <td className="px-4 py-2 font-medium text-ink">
                      <div className="flex items-center gap-2">
                        {v.effectiveFrom.slice(0, 10)}
                        {v.id === currentVersionId && <Badge tone="good">Vigente</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-ink-secondary">
                      {v.dayStartTime.slice(11, 16)} - {v.nightStartTime.slice(11, 16)}
                    </td>
                    <td className="px-4 py-2 text-ink-secondary">{v.maxWeeklyHours}h</td>
                    <td className="px-4 py-2 text-ink-secondary">{Math.round(Number(v.pctDominicalFestivo) * 100)}%</td>
                    <td className="px-4 py-2 text-ink-secondary">{Math.round(Number(v.pctHoraExtraDiurna) * 100)}%</td>
                    <td className="px-4 py-2 text-ink-muted">{v.notes ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => setEditingId(v.id)} className="text-ink-muted hover:text-ink" title="Editar version">
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && versions.length === 0 && !creating && (
        <Card className="flex items-start gap-3 p-4">
          <SlidersHorizontal className="mt-0.5 shrink-0 text-ink-muted" size={16} />
          <p className="text-sm text-ink-secondary">
            Aun no hay parametros configurados — sin esto el sistema no puede calcular novedades. Crea la primera version con
            el boton de arriba.
          </p>
        </Card>
      )}
    </div>
  );
}
