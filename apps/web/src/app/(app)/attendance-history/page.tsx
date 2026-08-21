'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MapPin, Image as ImageIcon, Pencil, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Employee, getEmployees, getTimeLogHistory, photoUrl, TimeLogHistoryEntry } from '@/lib/api';

const inputClass =
  'mt-1 w-full rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

const LOG_TYPE_LABELS: Record<string, string> = {
  CHECK_IN: 'Entrada',
  LUNCH_OUT: 'Salida almuerzo',
  LUNCH_IN: 'Reingreso almuerzo',
  CHECK_OUT: 'Salida',
};

const SOURCE_LABELS: Record<string, string> = {
  KIOSK: 'Kiosco',
  MOBILE_GPS: 'App movil (GPS)',
  WEB: 'Web',
  MANUAL: 'Carga manual',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function AttendanceHistoryPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState(daysAgoISO(7));
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<TimeLogHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  useEffect(() => {
    getEmployees().then((list) => {
      setEmployees(list);
      if (list.length > 0) setEmployeeId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    getTimeLogHistory(employeeId, from, to)
      .then(setRows)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [employeeId, from, to]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Historial de Marcas"
        subtitle="Cada marca de entrada/salida con la hora, el metodo usado, las coordenadas GPS (si aplica) y la foto de evidencia. Esta vista es solo de lectura — para corregir una hora equivocada o revisar llegadas tarde y demas novedades, usa 'Corregir marcas y novedades'."
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="block text-sm font-medium text-ink-secondary">Empleado</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} — {e.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-secondary">Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-secondary">Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </div>
          {employeeId && (
            <Link href={`/payroll-manual?employeeId=${employeeId}&from=${from}&to=${to}`}>
              <Button variant="secondary">
                <Pencil size={16} />
                Corregir marcas y novedades
              </Button>
            </Link>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {error && <p className="p-4 text-sm text-red-700">{error}</p>}
        {loading ? (
          <p className="p-6 text-center text-sm text-ink-muted">Cargando...</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-muted">No hay marcas en este rango de fechas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-hair text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                <th className="px-4 py-3">Fecha y hora</th>
                <th className="px-4 py-3">Marca</th>
                <th className="px-4 py-3">Metodo</th>
                <th className="px-4 py-3">Sede</th>
                <th className="px-4 py-3">Ubicacion</th>
                <th className="px-4 py-3">Foto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-hair last:border-0">
                  <td className="px-4 py-3 text-ink">{new Date(row.loggedAt).toLocaleString('es-CO')}</td>
                  <td className="px-4 py-3">
                    <Badge tone="info">{LOG_TYPE_LABELS[row.logType] ?? row.logType}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">{SOURCE_LABELS[row.source] ?? row.source}</td>
                  <td className="px-4 py-3 text-ink-secondary">{row.workSite ?? '—'}</td>
                  <td className="px-4 py-3">
                    {row.latitude !== null && row.longitude !== null ? (
                      <a
                        href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`}
                        className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                      >
                        <MapPin size={14} />
                        Ver ubicación
                        {row.gpsValid === false && (
                          <Badge tone="warning" title="Fuera del radio permitido de la sede">
                            fuera de rango
                          </Badge>
                        )}
                      </a>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.photoUrl ? (
                      <button onClick={() => setPreviewPhoto(row.photoUrl)} className="block">
                        <img
                          src={photoUrl(row.photoUrl)}
                          alt="Foto de evidencia"
                          className="h-12 w-12 rounded-lg border border-line-hair object-cover transition-transform hover:scale-105"
                        />
                      </button>
                    ) : (
                      <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-page text-ink-muted">
                        <ImageIcon size={16} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setPreviewPhoto(null)}
        >
          <div className="relative max-h-[85vh] max-w-2xl">
            <button
              onClick={() => setPreviewPhoto(null)}
              className="absolute -top-10 right-0 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20"
            >
              <X size={20} />
            </button>
            <img src={photoUrl(previewPhoto)} alt="Foto de evidencia" className="max-h-[85vh] rounded-xl object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
