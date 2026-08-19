'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Users, Clock3, FileWarning, CalendarCheck2 } from 'lucide-react';
import {
  AttendanceRow,
  PendingIncidence,
  PendingOvertime,
  PendingRestCredit,
  getAttendance,
  getPendingIncidences,
  getPendingOvertime,
  getPendingRestCredits,
} from '@/lib/api';
import { NOVELTY_BADGE_CLASS, NOVELTY_LABELS, formatTime } from '@/lib/novelty-labels';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Card } from '@/components/ui/Card';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AttendanceDashboardPage() {
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [pendingOvertime, setPendingOvertime] = useState<PendingOvertime[]>([]);
  const [pendingIncidences, setPendingIncidences] = useState<PendingIncidence[]>([]);
  const [pendingRest, setPendingRest] = useState<PendingRestCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([getAttendance(date), getPendingOvertime(), getPendingIncidences(), getPendingRestCredits()])
      .then(([attendance, overtime, incidences, rest]) => {
        setRows(attendance);
        setPendingOvertime(overtime);
        setPendingIncidences(incidences);
        setPendingRest(rest);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [date]);

  const chartData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      for (const n of row.novelties) {
        totals.set(n.code, (totals.get(n.code) ?? 0) + n.hours);
      }
    }
    return Array.from(totals.entries())
      .map(([code, hours]) => ({ code: NOVELTY_LABELS[code] ?? code, hours: Math.round(hours * 100) / 100 }))
      .sort((a, b) => b.hours - a.hours);
  }, [rows]);

  const pendingOvertimeHours = pendingOvertime.reduce((sum, o) => sum + Number(o.requestedHours), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard de Marcas y Novedades"
        subtitle="Asistencia diaria calculada con el motor CST Colombia."
        actions={
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink"
          />
        }
      />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Empleados con marcas hoy" value={rows.length} icon={Users} />
        <StatCard
          label="Horas extra pendientes"
          value={`${Math.round(pendingOvertimeHours * 10) / 10}h`}
          icon={Clock3}
          tone={pendingOvertime.length > 0 ? 'warning' : 'good'}
          hint={`${pendingOvertime.length} solicitud(es)`}
        />
        <StatCard
          label="Permisos/incapacidades"
          value={pendingIncidences.length}
          icon={FileWarning}
          tone={pendingIncidences.length > 0 ? 'warning' : 'good'}
          hint="pendientes de aprobar"
        />
        <StatCard
          label="Descansos compensatorios"
          value={pendingRest.length}
          icon={CalendarCheck2}
          tone={pendingRest.length > 0 ? 'warning' : 'good'}
          hint="pendientes de agendar"
        />
      </div>

      {chartData.length > 0 && (
        <Card className="p-5">
          <div className="text-sm font-medium text-ink">Horas por concepto — {date}</div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" vertical={false} />
                <XAxis dataKey="code" tick={{ fontSize: 12, fill: '#898781' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#898781' }} axisLine={false} tickLine={false} width={32} />
                <Tooltip
                  cursor={{ fill: '#f0efec' }}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e1e0d9', fontSize: 13 }}
                  formatter={(value) => [`${value}h`, 'Horas']}
                />
                <Bar dataKey="hours" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line-hair text-sm">
            <thead className="bg-surface-page">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-ink-secondary">Empleado</th>
                <th className="px-4 py-3 text-left font-semibold text-ink-secondary">Entrada</th>
                <th className="px-4 py-3 text-left font-semibold text-ink-secondary">Salida almuerzo</th>
                <th className="px-4 py-3 text-left font-semibold text-ink-secondary">Reingreso almuerzo</th>
                <th className="px-4 py-3 text-left font-semibold text-ink-secondary">Salida</th>
                <th className="px-4 py-3 text-left font-semibold text-ink-secondary">Novedades</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hair">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-muted">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-muted">
                    Sin marcas para esta fecha.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row) => (
                  <tr key={row.user.id} className="transition-colors hover:bg-surface-page/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{row.user.fullName}</div>
                      <div className="text-xs text-ink-muted">
                        {row.user.employeeCode} · {row.user.department}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{formatTime(row.marks.checkIn)}</td>
                    <td className="px-4 py-3 text-ink-secondary">{formatTime(row.marks.lunchOut)}</td>
                    <td className="px-4 py-3 text-ink-secondary">{formatTime(row.marks.lunchIn)}</td>
                    <td className="px-4 py-3 text-ink-secondary">{formatTime(row.marks.checkOut)}</td>
                    <td className="px-4 py-3">
                      {row.novelties.length === 0 ? (
                        <span className="text-ink-muted">Sin novedades</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {row.novelties.map((n, i) => (
                            <span
                              key={i}
                              title={n.notes ?? undefined}
                              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${NOVELTY_BADGE_CLASS[n.status] ?? NOVELTY_BADGE_CLASS.AUTO_CALCULADA}`}
                            >
                              {NOVELTY_LABELS[n.code] ?? n.code} · {n.hours}h
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
