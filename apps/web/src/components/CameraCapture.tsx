'use client';

import { useState } from 'react';
import { Camera, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useCameraStream } from '@/hooks/useCameraStream';

interface CameraCaptureProps {
  onCapture: (imageBase64: string) => void;
  height?: number;
}

/** Camara reutilizable: muestra el video en vivo y captura una foto como JPEG base64. La foto nunca sale de esta app hacia un tercero. */
export function CameraCapture({ onCapture, height = 280 }: CameraCaptureProps) {
  const { videoRef, ready, error, capturePhoto } = useCameraStream();
  const [captured, setCaptured] = useState<string | null>(null);

  function takePhoto() {
    const dataUrl = capturePhoto(0.9);
    if (!dataUrl) return;
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
