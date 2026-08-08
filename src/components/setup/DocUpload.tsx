import { useCallback, useRef, useState, type DragEvent } from "react";
import { ImagePlus, UploadCloud } from "lucide-react";
import type { DocInput } from "@/shared/contract";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DocUploadProps = {
  onAnalyzed: (doc: DocInput) => void;
  busy: boolean;
};

export function DocUpload({ onAnalyzed, busy }: DocUploadProps) {
  const [doc, setDoc] = useState<DocInput | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const doc: DocInput = { dataUrl: String(reader.result), mimeType: file.type };
      setDoc(doc);
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  return (
    <div className="flex flex-col gap-6">
      {doc ? (
        <div className="flex flex-col gap-4">
          <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-xl border bg-card shadow-sm">
            <img
              src={doc.dataUrl}
              alt="Uploaded document preview"
              className="max-h-72 w-full object-contain"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDoc(null);
                inputRef.current?.click();
              }}
            >
              <ImagePlus />
              Choose another
            </Button>
            <Button onClick={() => onAnalyzed(doc)} disabled={busy}>
              {busy ? "Reading document…" : "Analyze document"}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-card p-8 text-center transition-colors",
            dragging ? "border-ring bg-accent/20" : "border-border",
          )}
        >
          <div className="rounded-full bg-secondary p-4">
            <UploadCloud className="size-8 text-primary" />
          </div>
          <div>
            <p className="font-medium">Drop a photo of your document here</p>
            <p className="mt-1 text-sm text-muted-foreground">
              e.g. a notice from the ward office, renewal letter, or any letter you need to act on
            </p>
          </div>
          <Button type="button" variant="outline">
            Browse files
          </Button>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) readFile(file);
        }}
      />
    </div>
  );
}
