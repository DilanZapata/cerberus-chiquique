'use client';

import { FormEvent, useState } from 'react';
import { FileSpreadsheet, Download } from 'lucide-react';
import { downloadPayrollReport } from '@/lib/api';
import { getCompanyId } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const inputClass =
  'mt-1 w-full rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

export default function ReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleDownload(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setDone(false);
    try {
      const companyId = getCompanyId();
      if (!companyId) throw new Error('No se encontro la empresa de la sesion actual.');
      await downloadPayrollReport(companyId, from, to);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exportar Nomina"
        subtitle="Genera el reporte en Excel con RNO, DDCOF, DNCOF, HEOD, HEON, HEFD, HEFN, horas no autorizadas y resumen de ausencias por empleado."
      />

      <Card className="mx-auto max-w-xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <FileSpreadsheet size={20} />
          </div>
          <div className="text-sm font-medium text-ink">Reporte de nomina de tu empresa</div>
        </div>

        <form onSubmit={handleDownload} className="mt-4 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-ink-secondary">Desde</label>
              <input required type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-ink-secondary">Hasta</label>
              <input required type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
            </div>
          </div>
          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          {done && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">Descarga iniciada.</p>}
          <Button variant="success" disabled={loading} className="w-full">
            <Download size={16} />
            {loading ? 'Generando...' : 'Descargar Excel'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
