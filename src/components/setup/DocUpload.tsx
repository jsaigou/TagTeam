import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  Camera,
  ImagePlus,
  Loader2,
  ScanLine,
  Smartphone,
  Trash2,
  UploadCloud,
} from "lucide-react";
import type { DocInput, ImageDoc } from "@/shared/contract";
import { useSession } from "@/state/session-context";
import { useWebcamAvailable } from "@/hooks/use-webcam-available";
import { useScannerAvailable } from "@/hooks/use-scanner-available";
import { Button } from "@/components/ui/button";
import { PhonePairingDialog } from "@/components/session/PhonePairingDialog";
import { cn } from "@/lib/utils";
import { ScanSheet } from "./ScanSheet";

type DocUploadProps = {
  onAnalyzed: (doc: DocInput) => void;
  busy: boolean;
};

function toImageDoc(dataUrl: string, mimeType: string): ImageDoc {
  return { kind: "image", dataUrl, mimeType };
}

/** An equal-size square action tile in the doc-capture grid. */
function ActionTile({
  icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border bg-card text-center transition-colors",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:border-primary/60 hover:bg-accent/20 active:bg-accent/30",
      )}
    >
      <span className="rounded-full bg-secondary p-3 text-primary">{icon}</span>
      <span className="px-2 text-sm font-medium leading-tight">{label}</span>
      {hint && <span className="px-2 text-[11px] leading-tight text-muted-foreground">{hint}</span>}
    </button>
  );
}

export function DocUpload({ onAnalyzed, busy }: DocUploadProps) {
  const [pages, setPages] = useState<ImageDoc[]>([]);
  const [dragging, setDragging] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { pendingUploads, ackPendingUpload } = useSession();
  const webcamAvailable = useWebcamAvailable();
  const scannerAvailable = useScannerAvailable();

  const readFiles = useCallback((files: FileList | File[]) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    for (const file of images) {
      const reader = new FileReader();
      reader.onload = () => {
        setPages((prev) => [...prev, toImageDoc(String(reader.result), file.type)]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const addScannedPage = useCallback((page: ImageDoc) => {
    setPages((prev) => [...prev, page]);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files?.length) readFiles(e.dataTransfer.files);
    },
    [readFiles],
  );

  const removePage = useCallback((index: number) => {
    setPages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addCompanionPage = useCallback(
    (upload: (typeof pendingUploads)[number]) => {
      setPages((prev) => [...prev, toImageDoc(upload.dataUrl, upload.mimeType)]);
      ackPendingUpload(upload.uploadId);
    },
    [ackPendingUpload],
  );

  const analyze = () => {
    if (pages.length === 1) {
      onAnalyzed(pages[0]);
    } else if (pages.length > 1) {
      onAnalyzed({ kind: "images", images: pages });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <ActionTile
          icon={<ImagePlus className="size-6" />}
          label="Upload a photo"
          hint="From your device"
          onClick={() => inputRef.current?.click()}
        />
        <ActionTile
          icon={<Smartphone className="size-6" />}
          label="Scan with smartphone"
          hint="Camera + remote control"
          onClick={() => setPairOpen(true)}
        />
        {webcamAvailable && (
          <ActionTile
            icon={<Camera className="size-6" />}
            label="Use webcam"
            hint="Desktop camera"
            onClick={() => setScanOpen(true)}
          />
        )}
        {scannerAvailable && (
          <ActionTile
            icon={<ScanLine className="size-6" />}
            label="Scan"
            hint="Document scanner"
            onClick={() => setScanOpen(true)}
          />
        )}
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-card text-center transition-colors",
            dragging ? "border-ring bg-accent/20" : "border-border",
          )}
        >
          <span className="rounded-full bg-secondary p-3">
            <UploadCloud className="size-6 text-primary" />
          </span>
          <span className="px-2 text-sm font-medium leading-tight">Drop photos here</span>
          <span className="px-2 text-[11px] leading-tight text-muted-foreground">
            Multiple pages are fine
          </span>
        </div>
      </div>

      {pages.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pages.map((page, i) => (
            <div key={i} className="group relative">
              <img
                src={page.dataUrl}
                alt={`Page ${i + 1}`}
                className="h-24 w-[4.5rem] rounded-lg border object-cover shadow-sm"
              />
              <button
                type="button"
                aria-label="Remove page"
                onClick={() => removePage(i)}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Trash2 className="size-3" />
              </button>
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                {i + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Companion-pushed pages (from the phone) */}
      {pendingUploads.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
          <p className="text-xs font-medium text-primary">
            From your phone ({pendingUploads.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {pendingUploads.map((upload) => (
              <div key={upload.uploadId} className="relative">
                <img
                  src={upload.dataUrl}
                  alt={upload.filename}
                  className="h-20 w-14 rounded-lg border object-cover"
                />
                <button
                  type="button"
                  aria-label="Add page from phone"
                  onClick={() => addCompanionPage(upload)}
                  className="absolute -bottom-1.5 -right-1.5 rounded-full bg-primary p-1 text-primary-foreground"
                >
                  <ImagePlus className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pages.length > 0 && (
        <Button onClick={analyze} disabled={busy} size="lg">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Reading {pages.length} page{pages.length === 1 ? "" : "s"}…
            </>
          ) : (
            `Analyze ${pages.length} page${pages.length === 1 ? "" : "s"}`
          )}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) readFiles(e.target.files);
        }}
      />

      <ScanSheet open={scanOpen} onOpenChange={setScanOpen} onAdd={addScannedPage} />
      <PhonePairingDialog open={pairOpen} onOpenChange={setPairOpen} />
    </div>
  );
}