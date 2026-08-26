import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ImagePlus,
  Loader2,
  RefreshCw,
  ScanLine,
  X,
} from "lucide-react";
import type { ImageDoc } from "@/shared/contract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { scanFrame, type ScanResult } from "@/lib/scan";

type ScanSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (page: ImageDoc) => void;
};

/**
 * Camera + document-scan sheet (OpenCV edge-detect + perspective crop).
 * Shared by the desktop setup flow and the phone companion. OpenCV.js loads
 * lazily on first capture; if it is unavailable, the raw frame is used.
 */
export function ScanSheet({ open, onOpenChange, onAdd }: ScanSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [captured, setCaptured] = useState<ScanResult | null>(null);

  /* Start/stop the camera with the dialog. */
  useEffect(() => {
    if (!open) return;
    const videoEl = videoRef.current;
    let stream: MediaStream | null = null;
    let disposed = false;
    setCameraError(null);
    setCameraReady(false);
    setCaptured(null);
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((s) => {
        if (disposed) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoEl) {
          videoEl.srcObject = s;
          void videoEl.play().catch(() => {});
        }
        setCameraReady(true);
      })
      .catch((err: unknown) => {
        setCameraError(err instanceof Error ? err.message : "Camera unavailable");
      });
    return () => {
      disposed = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoEl) videoEl.srcObject = null;
    };
  }, [open]);

  const resetToLive = useCallback(() => {
    setCaptured(null);
    setProcessing(false);
  }, []);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = frameRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    setProcessing(true);
    try {
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight, 1));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = await scanFrame(canvas);
      setCaptured(result);
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCaptured({ dataUrl: String(reader.result), detected: false });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleUse = useCallback(() => {
    if (!captured) return;
    onAdd({ kind: "image", dataUrl: captured.dataUrl, mimeType: "image/jpeg" });
    resetToLive();
  }, [captured, onAdd, resetToLive]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="size-4 text-primary" />
            Scan a document page
          </DialogTitle>
        </DialogHeader>

        {captured ? (
          <div className="flex flex-col gap-3">
            <div className="relative overflow-hidden rounded-xl border bg-muted">
              <img
                src={captured.dataUrl}
                alt="Scanned page preview"
                className="max-h-72 w-full object-contain"
              />
              {captured.detected && (
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                  <Check className="size-3" />
                  Auto-cropped
                </span>
              )}
              {!captured.detected && (
                <span className="absolute left-2 top-2 inline-flex items-center rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  No edges found. Full photo
                </span>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetToLive}>
                <RefreshCw />
                Retake
              </Button>
              <Button onClick={handleUse}>
                <Check />
                Use page
              </Button>
            </div>
          </div>
        ) : processing ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-3">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Detecting edges… (first scan loads OpenCV)
            </p>
          </div>
        ) : cameraError ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-3">
            <p className="text-center text-sm text-muted-foreground">{cameraError}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                <X />
                Close
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <ImagePlus />
                Choose a photo instead
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative overflow-hidden rounded-xl border bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-[3/4] w-full object-cover"
              />
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-white/80" />
                </div>
              )}
            </div>
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                <X />
                Cancel
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <ImagePlus />
                Upload
              </Button>
              <Button onClick={() => void handleCapture()} disabled={!cameraReady}>
                <ScanLine />
                Capture
              </Button>
            </div>
          </div>
        )}

        <canvas ref={frameRef} className="hidden" />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
