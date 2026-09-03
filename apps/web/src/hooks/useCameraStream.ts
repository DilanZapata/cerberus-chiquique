'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Maneja el ciclo de vida de un stream de camara frontal (pedir permiso,
 * conectarlo a un <video>, liberarlo al desmontar) y expone una funcion
 * imperativa para capturar el frame actual como JPEG base64 -- equivalente
 * web de `cameraRef.current.takePictureAsync()` de expo-camera. Compartida
 * por `CameraCapture` (captura manual unica) y por el kiosco (sondeo
 * continuo con distintas calidades por foto).
 */
export function useCameraStream() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch {
        if (!cancelled) setError('No se pudo acceder a la camara. Revisa los permisos del navegador.');
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  /** Captura el frame actual del video como JPEG base64 (data URL). `quality` va de 0 a 1. */
  function capturePhoto(quality = 0.9): string | null {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  return { videoRef, ready, error, capturePhoto };
}
