'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { CameraCapture } from './CameraCapture';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { enrollFace } from '@/lib/api';

const CONSENT_TEXT =
  'Autorizo expresamente a la empresa a procesar mi imagen facial (dato biometrico, dato sensible segun la Ley 1581 de 2012) ' +
  'con la unica finalidad de registrar mi entrada y salida laboral en el sistema Cerberus. Entiendo que esta informacion se ' +
  'procesa y almacena en los servidores propios de la empresa, nunca se comparte con servicios de terceros, y que puedo ' +
  'solicitar la eliminacion de mi registro biometrico en cualquier momento.';

export function FaceEnrollPanel({
  userId,
  fullName,
  onDone,
  onCancel,
}: {
  userId: string;
  fullName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [consented, setConsented] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!image) return;
    setSubmitting(true);
    setError(null);
    try {
      await enrollFace({ userId, imageBase64: image, consentText: CONSENT_TEXT });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <ShieldCheck size={16} className="text-brand-600" />
        Enrolar rostro — {fullName}
      </div>

      {!consented ? (
        <div className="mt-3 space-y-3">
          <div className="max-h-40 overflow-y-auto rounded-lg bg-surface-page p-3 text-xs leading-relaxed text-ink-secondary">
            {CONSENT_TEXT}
          </div>
          <label className="flex items-start gap-2 text-sm text-ink-secondary">
            <input type="checkbox" className="mt-0.5" onChange={(e) => setConsented(e.target.checked)} />
            El empleado leyo y acepta expresamente este tratamiento de su dato biometrico.
          </label>
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <CameraCapture onCapture={setImage} />
          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button disabled={!image || submitting} onClick={submit} className="flex-1">
              {submitting ? 'Guardando...' : 'Registrar rostro'}
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
