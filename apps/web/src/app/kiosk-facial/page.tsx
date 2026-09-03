'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KioskApiError, kioskClock, kioskFaceClock, kioskFaceProbe } from '@/lib/api';
import { useCameraStream } from '@/hooks/useCameraStream';

const LOG_TYPE_LABELS: Record<string, string> = {
  CHECK_IN: 'Entrada registrada',
  LUNCH_OUT: 'Salida a almuerzo registrada',
  LUNCH_IN: 'Reingreso de almuerzo registrado',
  CHECK_OUT: 'Salida registrada',
};

// Todo configurable en un solo lugar, igual que en el kiosco movil.
const PROBE_INTERVAL_MS = 1200; // cada cuanto se toma una foto liviana para sondear si hay alguien
const STABILITY_THRESHOLD = 2; // sondeos consecutivos de la MISMA persona antes de capturar de verdad
const RESULT_DISPLAY_MS = 3500; // cuanto se muestra el resultado (exito/rechazo/error) en pantalla
const COOLDOWN_MS = 2500; // pausa corta tras mostrar el resultado antes de reanudar la deteccion

type KioskState = 'INITIALIZING' | 'READY' | 'DETECTING' | 'CAPTURING' | 'PROCESSING' | 'SUCCESS' | 'REJECTED' | 'ERROR' | 'COOLDOWN';
type ResultTone = 'success' | 'warning' | 'error';

const FRAME_COLOR: Record<KioskState, string> = {
  INITIALIZING: '#cbd5e1',
  READY: '#cbd5e1',
  DETECTING: '#3b82f6',
  CAPTURING: '#3b82f6',
  PROCESSING: '#f59e0b',
  SUCCESS: '#059669',
  REJECTED: '#d97706',
  ERROR: '#dc2626',
  COOLDOWN: '#cbd5e1',
};

const STATUS_LABEL: Record<KioskState, string> = {
  INITIALIZING: 'Preparando camara...',
  READY: 'Buscando rostro...',
  DETECTING: 'Buscando rostro...',
  CAPTURING: 'Rostro detectado, capturando...',
  PROCESSING: 'Validando informacion...',
  SUCCESS: 'Registro exitoso',
  REJECTED: 'No fue posible validar el registro',
  ERROR: 'Ocurrio un problema',
  COOLDOWN: 'Preparando el siguiente registro...',
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
 * Modo Kiosco web: la camara analiza continuamente buscando un rostro
 * (sondeo periodico contra `/kiosk/face-probe`, que solo identifica sin
 * registrar nada) y, cuando detecta la MISMA persona de forma estable
 * durante `STABILITY_THRESHOLD` sondeos seguidos, captura automaticamente y
 * registra la marca real via `/kiosk/face-clock` (sujeto al guard de
 * duplicados de 5 minutos del backend). El PIN queda como respaldo
 * secundario. Puerto directo de la misma maquina de estados del kiosco
 * movil (apps/mobile/src/screens/KioskScreen.tsx), sin login previo.
 */
export default function KioskFacialPage() {
  const { videoRef, ready: cameraReady, error: cameraError, capturePhoto } = useCameraStream();

  const [kioskState, setKioskState] = useState<KioskState>('INITIALIZING');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [resultTone, setResultTone] = useState<ResultTone | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showPinMode, setShowPinMode] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  // Todo lo que decide el flujo (no solo lo visual) vive en refs: un
  // candado de proceso real que se revisa ANTES de disparar cualquier
  // captura, no solo un boton deshabilitado.
  const isProcessingRef = useRef(false);
  const pageVisibleRef = useRef(true);
  const stableMatchRef = useRef<{ fullName: string; count: number } | null>(null);
  const coordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Equivalente web de useIsFocused: pausa el sondeo si la pestana no esta visible.
  useEffect(() => {
    function handleVisibility() {
      pageVisibleRef.current = !document.hidden;
      setPageVisible(!document.hidden);
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  function clearAllTimers() {
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    if (cooldownTimeoutRef.current) clearTimeout(cooldownTimeoutRef.current);
    pollTimeoutRef.current = null;
    resultTimeoutRef.current = null;
    cooldownTimeoutRef.current = null;
  }

  function scheduleNextProbe(delayMs: number) {
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    pollTimeoutRef.current = setTimeout(runProbeTick, delayMs);
  }

  /** Un solo sondeo: toma una foto liviana, pregunta quien es (sin registrar nada), y decide si ya hay estabilidad suficiente para capturar de verdad. */
  async function runProbeTick() {
    if (!pageVisibleRef.current || isProcessingRef.current || showPinMode || !coordsRef.current) return;

    try {
      const photo = capturePhoto(0.4);
      if (isProcessingRef.current || !pageVisibleRef.current) return; // pudo cambiar mientras se tomaba la foto
      if (!photo) {
        stableMatchRef.current = null;
        setKioskState('DETECTING');
        setStatusDetail(null);
        scheduleNextProbe(PROBE_INTERVAL_MS);
        return;
      }

      const result = await kioskFaceProbe(coordsRef.current.latitude, coordsRef.current.longitude, photo);
      if (isProcessingRef.current || !pageVisibleRef.current) return;

      if (result.recognized && result.fullName) {
        if (stableMatchRef.current?.fullName === result.fullName) {
          stableMatchRef.current.count += 1;
        } else {
          stableMatchRef.current = { fullName: result.fullName, count: 1 };
        }
        setKioskState('DETECTING');
        setStatusDetail(`Rostro detectado: ${result.fullName}. Mantente frente a la camara...`);

        if (stableMatchRef.current.count >= STABILITY_THRESHOLD) {
          stableMatchRef.current = null;
          await captureAndCommit();
          return; // captureAndCommit ya se encarga de reanudar el sondeo cuando corresponda
        }
      } else {
        stableMatchRef.current = null;
        setKioskState('DETECTING');
        setStatusDetail(null);
      }
    } catch {
      // Fallo de red/temporal en el sondeo: no es una condicion de error
      // para el usuario, simplemente se sigue buscando en el proximo ciclo.
      stableMatchRef.current = null;
    }

    scheduleNextProbe(PROBE_INTERVAL_MS);
  }

  /**
   * Funcion UNICA de captura+registro, usada tanto por la deteccion
   * automatica (al llegar a la estabilidad requerida) como por el boton
   * manual -- exactamente las mismas reglas de seguridad para ambas. El
   * candado `isProcessingRef` se activa aqui y solo se libera cuando el
   * flujo vuelve a READY (incluye el tiempo de mostrar el resultado y el
   * cooldown), nunca antes.
   */
  const captureAndCommit = useCallback(async () => {
    if (isProcessingRef.current || !coordsRef.current) return;

    isProcessingRef.current = true;
    setIsProcessing(true);
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    setKioskState('CAPTURING');
    setResultMessage(null);
    setResultTone(null);

    try {
      const photo = capturePhoto(0.7);
      if (!photo) throw new Error('No se pudo tomar la foto.');

      setKioskState('PROCESSING');
      const result = await kioskFaceClock(coordsRef.current.latitude, coordsRef.current.longitude, photo);
      setResultTone('success');
      setResultMessage(`${result.fullName}: ${LOG_TYPE_LABELS[result.logType]} a las ${new Date(result.loggedAt).toLocaleTimeString()}`);
      setKioskState('SUCCESS');
    } catch (err) {
      if (err instanceof KioskApiError) {
        setResultTone('warning');
        setResultMessage(err.message);
        setKioskState('REJECTED');
      } else {
        setResultTone('error');
        setResultMessage((err as Error).message || 'No se pudo conectar con el servidor. Intenta de nuevo.');
        setKioskState('ERROR');
      }
    }

    scheduleReturnToReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturePhoto]);

  /** Muestra el resultado un tiempo breve, pasa por un cooldown corto, y solo ENTONCES libera el candado real y reanuda la deteccion. */
  function scheduleReturnToReady() {
    resultTimeoutRef.current = setTimeout(() => {
      setKioskState('COOLDOWN');
      cooldownTimeoutRef.current = setTimeout(() => {
        isProcessingRef.current = false;
        setIsProcessing(false);
        stableMatchRef.current = null;
        setResultMessage(null);
        setResultTone(null);
        setStatusDetail(null);
        if (pageVisibleRef.current && !showPinMode) {
          setKioskState('READY');
          scheduleNextProbe(0);
        }
      }, COOLDOWN_MS);
    }, RESULT_DISPLAY_MS);
  }

  /** Respaldo manual: misma funcion de captura+registro, mismo candado -- solo se dispara si nada esta en proceso. */
  function handleManualCapture() {
    if (isProcessingRef.current) return;
    captureAndCommit();
  }

  const initialize = useCallback(async () => {
    setKioskState('INITIALIZING');
    setLocationError(null);
    try {
      const coords = await getCurrentCoords();
      coordsRef.current = coords;
      setKioskState('READY');
      scheduleNextProbe(0);
    } catch (err) {
      coordsRef.current = null;
      setLocationError((err as Error).message);
      setKioskState('ERROR');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ciclo de vida: solo se inicializa/sondea mientras la camara esta lista,
  // la pestana esta visible y no estamos en modo PIN. Al perder cualquiera
  // de estas condiciones se limpian los timers y se libera el candado -- al
  // volver, se reinicializa desde cero (nueva ubicacion, nuevo ciclo).
  useEffect(() => {
    if (!pageVisible || !cameraReady || showPinMode) {
      clearAllTimers();
      isProcessingRef.current = false;
      setIsProcessing(false);
      stableMatchRef.current = null;
      return;
    }
    initialize();
    return () => {
      clearAllTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageVisible, cameraReady, showPinMode]);

  // ---- Modo PIN (respaldo) ----
  const [employeeCode, setEmployeeCode] = useState('');
  const [pin, setPin] = useState('');
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);

  function pressDigit(digit: string) {
    if (pin.length < 6) setPin(pin + digit);
  }

  async function submitPin() {
    setPinLoading(true);
    setPinError(null);
    setPinMessage(null);
    try {
      const coords = await getCurrentCoords();
      const photo = cameraReady ? capturePhoto(0.5) : null;
      const result = await kioskClock({ ...coords, employeeCode, pin, imageBase64: photo ?? undefined });
      setPinMessage(`${result.fullName}: ${LOG_TYPE_LABELS[result.logType]} a las ${new Date(result.loggedAt).toLocaleTimeString()}`);
      setEmployeeCode('');
      setPin('');
    } catch (err) {
      setPinError((err as Error).message);
    } finally {
      setPinLoading(false);
    }
  }

  // ---- Render ----

  if (showPinMode) {
    return (
      <main className="flex min-h-screen flex-col items-center bg-surface-page p-6">
        <div className="w-full max-w-sm">
          <button
            type="button"
            onClick={() => setShowPinMode(false)}
            className="mb-4 text-sm font-semibold text-ink hover:underline"
          >
            &lsaquo; Volver al reconocimiento facial
          </button>
          <h1 className="text-lg font-bold text-ink">Marcar con codigo y PIN</h1>

          {cameraReady && (
            <div className="mx-auto mt-4 h-24 w-24 overflow-hidden rounded-full bg-black">
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
            </div>
          )}

          <input
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
            placeholder="Codigo de empleado"
            className="mt-6 w-full rounded-lg border border-line-axis bg-surface-card px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <p className="mt-4 text-center text-3xl tracking-[0.5em] text-ink">{'•'.repeat(pin.length) || 'PIN'}</p>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) => (
              <button
                key={i}
                type="button"
                disabled={!key}
                onClick={() => (key === '⌫' ? setPin(pin.slice(0, -1)) : key && pressDigit(key))}
                className="h-14 rounded-lg bg-surface-card text-xl font-semibold text-ink disabled:opacity-0 enabled:hover:bg-line-hair"
              >
                {key}
              </button>
            ))}
          </div>

          {pinError && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{pinError}</p>}
          {pinMessage && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-700">{pinMessage}</p>}

          <button
            type="button"
            onClick={submitPin}
            disabled={pinLoading || !employeeCode || !pin}
            className="mt-5 w-full rounded-lg bg-ink py-3.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {pinLoading ? 'Marcando...' : 'Marcar'}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-2 bg-surface-page p-6">
      <Link
        href="/login"
        className="absolute right-4 top-4 rounded-full bg-surface-card px-3.5 py-1.5 text-xs font-semibold text-ink-secondary shadow-sm hover:text-ink"
      >
        Iniciar sesion
      </Link>

      <h1 className="text-xl font-bold text-ink">Cerberus</h1>
      <p className="mb-2 text-sm text-ink-muted">Ubicate frente a la camara para marcar tu asistencia</p>

      {cameraError ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-center text-sm text-red-700">{cameraError}</div>
      ) : locationError ? (
        <div className="flex flex-col items-center gap-3">
          <p className="max-w-sm text-center text-sm text-red-700">{locationError}</p>
          <button type="button" onClick={initialize} className="rounded-lg bg-ink px-6 py-3 text-sm font-bold text-white">
            Reintentar
          </button>
        </div>
      ) : (
        <>
          <div
            className="h-64 w-64 overflow-hidden rounded-full border-4 bg-black transition-colors"
            style={{ borderColor: FRAME_COLOR[kioskState] }}
          >
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          </div>

          <p className="mt-3 text-base font-bold text-ink">{STATUS_LABEL[kioskState]}</p>
          {statusDetail && kioskState === 'DETECTING' && <p className="max-w-xs text-center text-xs text-ink-secondary">{statusDetail}</p>}
          {resultMessage && (
            <p
              className={`max-w-xs text-center text-sm font-semibold ${
                resultTone === 'success' ? 'text-emerald-700' : resultTone === 'warning' ? 'text-amber-700' : 'text-red-700'
              }`}
            >
              {resultMessage}
            </p>
          )}

          <button
            type="button"
            onClick={handleManualCapture}
            disabled={isProcessing || !cameraReady}
            className="mt-3 rounded-lg bg-ink px-8 py-3.5 text-sm font-bold text-white disabled:bg-slate-400"
          >
            {kioskState === 'CAPTURING' || kioskState === 'PROCESSING' ? 'Procesando...' : 'Capturar manualmente'}
          </button>
        </>
      )}

      <button type="button" onClick={() => setShowPinMode(true)} className="mt-5 text-xs text-ink-muted underline">
        Usar codigo y PIN
      </button>
    </main>
  );
}
