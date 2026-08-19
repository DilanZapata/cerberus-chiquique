'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface CameraCaptureProps {
  onCapture: (imageBase64: string) => void;
  height?: number;
}

/** Camara reutilizable: muestra el video en vivo y captura una foto como JPEG base64. La foto nunca sale de esta app hacia un tercero. */
export function CameraCapture({ onCapture, height = 280 }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setReady(true);
    } catch (err) {
      setError('No se pudo acceder a la camara. Revisa los permisos del navegador.');
    }
  }

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setCaptured(dataUrl);
    onCapture(dataUrl);
  }

  function retake() {
    setCaptured(null);
  }

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-lg bg-black"
        style={{ height }}
      >
        {error && (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-white">{error}</div>
        )}
        {!error && captured && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={captured} alt="Foto capturada" className="h-full w-full object-cover" />
        )}
        <video
          ref={videoRef}
          muted
          playsInline
          className={`h-full w-full object-cover ${captured || error ? 'hidden' : ''}`}
        />
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="mt-3 flex justify-center gap-2">
        {!captured ? (
          <Button type="button" onClick={takePhoto} disabled={!ready}>
            <Camera size={16} />
            Capturar foto
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={retake}>
            <RotateCcw size={15} />
            Repetir
          </Button>
        )}
      </div>
    </div>
  );
}
