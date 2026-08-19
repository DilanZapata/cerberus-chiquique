'use client';

import { useState } from 'react';
import { ShieldCheck, ScanFace } from 'lucide-react';
import { CameraCapture } from '@/components/CameraCapture';
import { kioskFaceClock } from '@/lib/api';

const LOG_TYPE_LABELS: Record<string, string> = {
  CHECK_IN: 'Entrada registrada',
  LUNCH_OUT: 'Salida a almuerzo registrada',
  LUNCH_IN: 'Reingreso de almuerzo registrado',
  CHECK_OUT: 'Salida registrada',
};

function getCurrentCoords(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Este navegador no soporta geolocalizacion.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => reject(new Error('Se necesita permiso de ubicacion para identificar la sede de este kiosco.')),
      { enableHighAccuracy: true },
    );
  });
}

/**
 * No requiere configuracion previa del dispositivo (sin token ni sede): el
 * backend identifica la sede (y la empresa) por la ubicacion GPS actual del
 * navegador, el mismo mecanismo de geocerca que usa el marcaje de
 * autoservicio movil.
 */
export default function KioskFacialPage() {
  const [captureKey, setCaptureKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCapture(imageBase64: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const coords = await getCurrentCoords();
      const result = await kioskFaceClock(coords.latitude, coords.longitude, imageBase64);
      setMessage(`${result.fullName}: ${LOG_TYPE_LABELS[result.logType]}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setCaptureKey((k) => k + 1), 2500);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-page p-8">
      <div className="flex items-center gap-2 text-lg font-semibold text-ink">
        <ScanFace size={22} className="text-brand-600" />
        Marcaje por reconocimiento facial
      </div>
      <p className="text-sm text-ink-muted">Mira a la camara y presiona "Capturar foto".</p>

      <div className="w-full max-w-md">
        <CameraCapture key={captureKey} onCapture={handleCapture} height={360} />
      </div>

      {busy && <p className="text-sm text-ink-muted">Verificando...</p>}
      {message && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
          <ShieldCheck size={16} />
          {message}
        </div>
      )}
      {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
    </main>
  );
}
