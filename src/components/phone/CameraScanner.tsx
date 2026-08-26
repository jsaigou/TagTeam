import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type CameraScannerProps = {
  /** Parses a decoded payload into a joinable hash; return null to keep scanning. */
  onDetected: (text: string) => void;
  onCancel: () => void;
};

const FACE_CAMERA = { facingMode: "environment" as const };
const SCAN_INTERVAL_MS = 120;

/** jsQR is only needed on the phone route — load it lazily (keeps the main
 *  bundle lean, same pattern as the OpenCV.js engine in src/lib/scan.ts). */
let jsqrPromise: Promise<typeof import("jsqr")> | null = null;
function loadJsQr(): Promise<typeof import("jsqr")> {
  jsqrPromise ??= import("jsqr");
  return jsqrPromise;
}

/**
 * Phase 5a — real camera QR scanning. Streams the phone camera into a hidden
 * canvas and runs jsQR on each frame until a QR is decoded. The desktop's
 * pairing QR encodes a full `/phone#s=<id>&p=<code>` join URL, so the payload
 * is handed back raw for normalization (joinHashFromQr). Cleanup is strict:
 * tracks stop, video pauses, the RAF loop cancels.
 */
export function CameraScanner({ onDetected, onCancel }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let lastScan = 0;

    const stop = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const scanFrame = (jsQR: (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(() => scanFrame(jsQR));
        return;
      }
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) {
        rafRef.current = requestAnimationFrame(() => scanFrame(jsQR));
        return;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        rafRef.current = requestAnimationFrame(() => scanFrame(jsQR));
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const now = performance.now();
      if (now - lastScan >= SCAN_INTERVAL_MS) {
        lastScan = now;
        const code = jsQR(imageData.data, w, h);
        if (code && code.data) {
          onDetected(code.data);
          return; // parent closes the scanner
        }
      }
      rafRef.current = requestAnimationFrame(() => scanFrame(jsQR));
    };

    const start = async () => {
      try {
        const [{ default: jsQR }, stream] = await Promise.all([
          loadJsQr(),
          navigator.mediaDevices.getUserMedia({ video: FACE_CAMERA, audio: false }),
        ]);
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {
            /* autoplay with a sound-less stream is generally allowed */
          });
        }
        setReady(true);
        rafRef.current = requestAnimationFrame(() => scanFrame(jsQR));
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError") {
          setError("Camera permission was denied. Allow camera access and try again.");
        } else if (name === "NotFoundError") {
          setError("No camera found on this device.");
        } else if (name === "NotReadableError") {
          setError("The camera is in use by another app.");
        } else {
          setError(err instanceof Error ? err.message : "Could not start the camera.");
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [onDetected]);

  const handleCancel = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    onCancel();
  }, [onCancel]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-xl border bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-square w-full object-cover"
        />
        {!ready && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <p className="text-xs">Starting camera…</p>
          </div>
        )}
        {ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="size-48 rounded-2xl border-2 border-accent/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ScanLine className="size-3.5" />
        Point the camera at the QR on the desktop screen.
      </p>

      <Button variant="ghost" size="sm" className="self-center" onClick={handleCancel}>
        <X />
        Cancel
      </Button>
    </div>
  );
}
