import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Mic,
  Pause,
  Play,
  ScanLine,
  Smartphone,
} from "lucide-react";
import type { ImageDoc, Turn } from "@/shared/contract";
import { useSession } from "@/state/session-context";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
import { joinHashFromQr, parsePhoneHash } from "@/lib/session-utils";
import { ScanSheet } from "@/components/setup/ScanSheet";
import { CameraScanner } from "@/components/phone/CameraScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  idle: "bg-muted-foreground",
  connecting: "bg-amber-500",
  open: "bg-emerald-500",
  closed: "bg-destructive",
};

type SentPage = { uploadId: string; dataUrl: string };

export function PhoneApp() {
  const {
    hubStatus,
    hubError,
    snapshot,
    devices,
    sentUploadIds,
    uploadFromCompanion,
    sendControl,
    sendPushToTalk,
    onPhase,
    onTurn,
  } = useSession();
  const ptt = usePushToTalk();
  const [code, setCode] = useState("");
  const [qrScanOpen, setQrScanOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [pages, setPages] = useState<SentPage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [liveTurns, setLiveTurns] = useState<Turn[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const hasCode = useMemo(
    () => parsePhoneHash(window.location.hash) !== null,
    // Re-evaluate when the hash changes (manual entry sets it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [window.location.hash],
  );

  /* Phase 3 — mirror the orchestrator's brain state and live transcript. */
  useEffect(() => onPhase((m) => setThinking(m.phase === "thinking")), [onPhase]);
  useEffect(
    () => onTurn((m) => setLiveTurns((prev) => [...prev.slice(-9), m.turn])),
    [onTurn],
  );

  const enterCode = () => {
    const trimmed = code.trim().toUpperCase().replace(/[^A-Z2-9]/g, "");
    if (trimmed.length < 6) return;
    window.location.hash = `#p=${encodeURIComponent(trimmed)}`;
  };

  /* A scanned QR (the desktop's full joinUrl) or a bare 6-char code becomes
     the join hash — adopt it so the session context joins. */
  const handleQrDetected = useCallback((payload: string) => {
    const hash = joinHashFromQr(payload);
    if (!hash) return;
    window.location.hash = hash;
    setQrScanOpen(false);
  }, []);

  const addPage = useCallback(
    async (page: ImageDoc) => {
      setSubmitting(true);
      try {
        const uploadId = await uploadFromCompanion(page);
        setPages((prev) => [...prev, { uploadId, dataUrl: page.dataUrl }]);
      } finally {
        setSubmitting(false);
      }
    },
    [uploadFromCompanion],
  );

  const handlePTTDown = useCallback(async () => {
    if (ptt.state === "recording") return;
    setVoiceError(null);
    await ptt.start();
  }, [ptt]);

  const handlePTTUp = useCallback(async () => {
    if (ptt.state !== "recording") return;
    const audio = await ptt.stop();
    if (!audio) return;
    try {
      await sendPushToTalk(audio);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Could not send your voice.");
    }
  }, [ptt, sendPushToTalk]);

  const connected = hubStatus === "open";
  const isHeld = snapshot?.status === "held";
  const running = snapshot?.status === "running" || snapshot?.status === "ready";
  const activeTurn = snapshot?.activeTurn;
  const userTurn = activeTurn?.speaker === "user";

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-3 px-4 py-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone className="size-5 text-primary" />
          <h1 className="text-base font-semibold">TagTeam companion</h1>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-full", STATUS_COLOR[hubStatus] ?? STATUS_COLOR.idle)} />
          {hubStatus}
        </span>
      </header>

      {!hasCode && (
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">Join the desktop session</p>
          <p className="text-sm text-muted-foreground">
            Scan the QR shown on the desktop, or type the 6-character code from
            the "Phone companion" panel.
          </p>
          {qrScanOpen ? (
            <CameraScanner
              onDetected={handleQrDetected}
              onCancel={() => setQrScanOpen(false)}
            />
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. K3M9QX"
                  className="font-mono uppercase tracking-widest"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") enterCode();
                  }}
                />
                <Button onClick={enterCode} disabled={code.trim().length < 6}>
                  Join
                </Button>
              </div>
              <Button variant="outline" onClick={() => setQrScanOpen(true)}>
                <ScanLine />
                Scan QR with camera
              </Button>
            </>
          )}
          {hubError && <p className="text-xs text-destructive">{hubError}</p>}
        </div>
      )}

      {hasCode && !connected && (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-6 text-center">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            {hubError ?? "Joining the session…"}
          </p>
        </div>
      )}

      {hasCode && connected && (
        <>
          {hubError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {hubError}
            </p>
          )}

          {/* Live stage status */}
          <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-primary">Desktop</p>
              <span className="text-xs text-muted-foreground">
                {devices.filter((d) => d.connected).length} device
                {devices.filter((d) => d.connected).length === 1 ? "" : "s"} connected
              </span>
            </div>
            <p className="text-sm text-foreground">
              {snapshot?.scriptTitle ?? snapshot?.summary ?? "Setting up the call…"}
            </p>
            {snapshot?.screen === "setup" && (
              <p className="text-xs text-muted-foreground">
                Step: {snapshot.setupStep}
              </p>
            )}
          </div>

          {/* Active call turn */}
          {activeTurn && (
            <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-primary">
                {userTurn ? "Your turn" : "They say"}
              </p>
              <p className="text-sm text-foreground">{activeTurn.jp}</p>
              {activeTurn.en && (
                <p className="text-xs text-muted-foreground">{activeTurn.en}</p>
              )}
            </div>
          )}

          {/* Call controls */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => sendControl("hold")}
              disabled={isHeld || !running}
            >
              <Pause />
              Hold
            </Button>
            <Button
              className="flex-1"
              onClick={() => sendControl("resume")}
              disabled={!isHeld}
            >
              <Play />
              Resume
            </Button>
          </div>

          {/* Phase 3 — companion mic: hold to speak, the server brain replies */}
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Speak</p>
              {(thinking || ptt.state === "recording") && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "size-1.5 animate-pulse rounded-full",
                      ptt.state === "recording" ? "bg-destructive" : "bg-accent",
                    )}
                  />
                  {ptt.state === "recording" ? "Listening…" : thinking ? "Office is thinking…" : ""}
                </span>
              )}
            </div>
            <button
              type="button"
              onPointerDown={() => void handlePTTDown()}
              onPointerUp={() => void handlePTTUp()}
              onPointerLeave={() => void handlePTTUp()}
              onPointerCancel={() => void handlePTTUp()}
              disabled={!ptt.supported || !running}
              className={cn(
                "flex select-none touch-none items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-4 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/25 active:bg-accent/30",
                (!ptt.supported || !running) && "cursor-not-allowed opacity-50",
              )}
            >
              <Mic className="size-4" />
              {ptt.state === "recording" ? "Release to send" : "Hold to speak"}
            </button>
            {voiceError && <p className="text-xs text-destructive">{voiceError}</p>}
            {liveTurns.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t pt-2">
                {liveTurns.map((t) => (
                  <div key={t.id} className="flex flex-col">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t.speaker === "user" ? "You" : "Office"}
                    </p>
                    <p className="text-sm text-foreground">{t.jp}</p>
                    {t.en && <p className="text-xs text-muted-foreground">{t.en}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Document scanning */}
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Scan a page</p>
              {submitting && <Loader2 className="size-4 animate-spin text-primary" />}
            </div>
            <p className="text-xs text-muted-foreground">
              Photos you scan here are sent to the desktop and added to the document
              bundle before the call is generated.
            </p>
            {pages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pages.map((p) => {
                  const received = !sentUploadIds.includes(p.uploadId);
                  return (
                    <div key={p.uploadId} className="relative">
                      <img
                        src={p.dataUrl}
                        alt="Sent page"
                        className="h-16 w-12 rounded-md border object-cover"
                      />
                      {received && (
                        <span className="absolute -right-1 -top-1 rounded-full bg-emerald-500 p-0.5 text-white">
                          <Check className="size-3" />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => setScanOpen(true)}
              disabled={submitting}
            >
              <ScanLine />
              Scan a page
            </Button>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            Speak into the call with the hold button — the desktop plays the office's reply.
          </p>
        </>
      )}

      <ScanSheet open={scanOpen} onOpenChange={setScanOpen} onAdd={(p) => void addPage(p)} />
    </div>
  );
}
