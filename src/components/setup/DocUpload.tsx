import { useCallback, useRef, useState, type DragEvent } from "react";
import {
  ImagePlus,
  Loader2,
  PencilLine,
  ScanLine,
  Trash2,
  UploadCloud,
} from "lucide-react";
import type { DocInput, ImageDoc } from "@/shared/contract";
import { useSession } from "@/state/session-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ScanSheet } from "./ScanSheet";

type DocUploadProps = {
  onAnalyzed: (doc: DocInput) => void;
  busy: boolean;
};

type Mode = "image" | "text";

function toImageDoc(dataUrl: string, mimeType: string): ImageDoc {
  return { kind: "image", dataUrl, mimeType };
}

export function DocUpload({ onAnalyzed, busy }: DocUploadProps) {
  const [mode, setMode] = useState<Mode>("image");
  const [pages, setPages] = useState<ImageDoc[]>([]);
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { pendingUploads, ackPendingUpload } = useSession();

  const readFiles = useCallback((files: FileList | File[]) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    for (const file of images) {
      const reader = new FileReader();
      reader.onload = () => {
        setPages((prev) => [
          ...prev,
          toImageDoc(String(reader.result), file.type),
        ]);
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
    if (mode === "text") {
      const text = description.trim();
      if (text) onAnalyzed({ kind: "text", text });
      return;
    }
    if (pages.length === 1) {
      onAnalyzed(pages[0]);
    } else if (pages.length > 1) {
      onAnalyzed({ kind: "images", images: pages });
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    if (next === "image") setDescription("");
    else setPages([]);
  };

  const canAnalyze =
    mode === "text" ? description.trim().length > 0 : pages.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
        <button
          type="button"
          onClick={() => switchMode("image")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            mode === "image"
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ImagePlus className="size-4" />
          Photos
        </button>
        <button
          type="button"
          onClick={() => switchMode("text")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            mode === "text"
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <PencilLine className="size-4" />
          Describe it
        </button>
      </div>

      {mode === "text" ? (
        <div className="flex flex-col gap-3">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what you need help with… e.g. I got a letter about my health insurance renewal and I need to call the ward office to confirm my details."
            className="min-h-40"
          />
          <Button onClick={analyze} disabled={!canAnalyze || busy} size="lg">
            {busy ? "Reading…" : "Analyze"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
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

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => inputRef.current?.click()}
            >
              <UploadCloud />
              Upload photos
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setScanOpen(true)}
            >
              <ScanLine />
              Scan with camera
            </Button>
          </div>

          {pages.length === 0 && (
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
                "flex min-h-36 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-card p-6 text-center transition-colors",
                dragging ? "border-ring bg-accent/20" : "border-border",
              )}
            >
              <div className="rounded-full bg-secondary p-3">
                <UploadCloud className="size-6 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                Drop photos here — multiple pages are fine
              </p>
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
        </div>
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
    </div>
  );
}
