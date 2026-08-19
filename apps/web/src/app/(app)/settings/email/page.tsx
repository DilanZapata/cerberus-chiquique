'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { EmailSettings, getEmailSettings, sendWeeklySummaryNow, upsertEmailSettings } from '@/lib/api';
import { getCompanyId } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const inputClass =
  'mt-1 w-full rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-ink-secondary';

export default function EmailSettingsPage() {
  const [form, setForm] = useState<EmailSettings & { smtpPassword: string }>({
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPassword: '',
    smtpSecurity: 'TLS',
    fromName: 'Cerberus RRHH',
    fromEmail: '',
    adminRecipients: [],
    weeklyAlertEnabled: true,
  });
  const [recipientsText, setRecipientsText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const companyId = getCompanyId();
    if (!companyId) return;
    getEmailSettings(companyId)
      .then((existing) => {
        if (existing) {
          setForm({ ...existing, smtpPassword: '' });
          setRecipientsText(existing.adminRecipients.join(', '));
        }
      })
      .catch(() => null);
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const companyId = getCompanyId();
      if (!companyId) throw new Error('No se encontro la empresa de la sesion actual.');
      const adminRecipients = recipientsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await upsertEmailSettings(companyId, { ...form, adminRecipients });
      setStatus('Configuracion SMTP guardada.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTest() {
    setError(null);
    setStatus(null);
    try {
      const companyId = getCompanyId();
      if (!companyId) throw new Error('No se encontro la empresa de la sesion actual.');
      const result = await sendWeeklySummaryNow(companyId);
      setStatus(
        result?.sent
          ? `Correo enviado a: ${(result.recipients ?? []).join(', ')}`
          : (result?.reason ?? 'No hay novedades pendientes por encima del umbral configurado.'),
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Configuracion SMTP" subtitle="Alertas semanales de novedades pendientes de autorizacion." />

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Mail size={20} />
          </div>
          <div className="text-sm font-medium text-ink">Servidor de correo saliente</div>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Host SMTP</label>
              <input required value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Puerto</label>
              <input
                required
                type="number"
                value={form.smtpPort}
                onChange={(e) => setForm({ ...form, smtpPort: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Usuario</label>
              <input required value={form.smtpUser} onChange={(e) => setForm({ ...form, smtpUser: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Clave de aplicacion</label>
              <input
                required
                type="password"
                value={form.smtpPassword}
                onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Seguridad</label>
              <select
                value={form.smtpSecurity}
                onChange={(e) => setForm({ ...form, smtpSecurity: e.target.value as EmailSettings['smtpSecurity'] })}
                className={inputClass}
              >
                <option value="NONE">Ninguna</option>
                <option value="TLS">TLS</option>
                <option value="SSL">SSL</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Nombre remitente</label>
              <input required value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} className={inputClass} />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Correo remitente</label>
              <input
                required
                type="email"
                value={form.fromEmail}
                onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Correos administrativos (separados por coma)</label>
              <input required value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)} className={inputClass} />
            </div>
          </div>

          {status && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{status}</p>}
          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

          <div className="flex gap-2">
            <Button disabled={saving} className="flex-1">
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
            <Button variant="secondary" type="button" onClick={handleSendTest} className="flex-1">
              <Send size={15} />
              Enviar resumen ahora
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
