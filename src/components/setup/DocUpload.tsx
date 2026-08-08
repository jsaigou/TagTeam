import { useCallback, useRef, useState, type DragEvent } from "react";
import { ImagePlus, PencilLine, UploadCloud } from "lucide-react";
import type { DocInput } from "@/shared/contract";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type DocUploadProps = {
  onAnalyzed: (doc: DocInput) => void;
  busy: boolean;
};

type Mode = "image" | "text";

export function DocUpload({ onAnalyzed, busy }: DocUploadProps) {
  const [mode, setMode] = useState<Mode>("image");
  const [doc, setDoc] = useState<DocInput | null>(null);
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image: DocInput = {
        kind: "image",
        dataUrl: String(reader.result),
        mimeType: file.type,
      };
      setDoc(image);
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

  const analyze = () => {
    if (mode === "text") {
      const text = description.trim();
      if (text) onAnalyzed({ kind: "text", text });
    } else if (doc) {
      onAnalyzed(doc);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    if (next === "image") setDescription("");
    else setDoc(null);
  };

  const canAnalyze =
    mode === "text" ? description.trim().length > 0 : Boolean(doc);

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
          Upload a photo
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
      ) : doc ? (
        <div className="flex flex-col gap-4">
          <div className="relative mx-auto w-full overflow-hidden rounded-xl border bg-card shadow-sm">
            <img
              src={doc.kind === "image" ? doc.dataUrl : ""}
              alt="Uploaded document preview"
              className="max-h-60 w-full object-contain"
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
            <Button onClick={analyze} disabled={busy}>
              {busy ? "Reading document…" : "Analyze document"}
            </Button>
          </div>
        </div>
      ) : (
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
            "flex min-h-44 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-card p-8 text-center transition-colors",
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
        </div>
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
