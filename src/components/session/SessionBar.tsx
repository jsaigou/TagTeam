import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2, RotateCcw, Smartphone } from "lucide-react";
import { useSession } from "@/state/session-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HUB_STATUS_LABEL: Record<string, string> = {
  idle: "Waiting",
  connecting: "Connecting…",
  open: "Connected",
  closed: "Disconnected",
};

/** Compact device indicator for the call screen header. */
export function DeviceBadge() {
  const { devices } = useSession();
  const count = devices.filter((d) => d.connected).length;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        count > 0 && "text-primary",
      )}
    >
      <Smartphone className="size-3.5" />
      {count > 0 ? `${count} phone connected` : "No phone connected"}
    </span>
  );
}

/**
 * Desktop QR pairing panel. Hidden by default — a "Connect a phone" button
 * reveals the QR code + 6-char code for the phone to scan (or type).
 */
export function SessionBar() {
  const { session, hubStatus, devices, hubError, rotatePairing } = useSession();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const connectedCount = devices.filter((d) => d.connected).length;
  const busy = hubStatus === "connecting";

  useEffect(() => {
    if (!session?.joinUrl) return;
    let active = true;
    QRCode.toDataURL(session.joinUrl, {
      width: 168,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [session?.joinUrl]);

  const copyCode = async () => {
    if (!session?.pairingToken) return;
    try {
      await navigator.clipboard.writeText(session.pairingToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the code is still visible */
    }
  };

  if (!session) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Starting phone session…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Phone companion</p>
        <span
          className={cn(
            "text-xs",
            hubStatus === "open" ? "text-primary" : "text-muted-foreground",
          )}
        >
          {connectedCount > 0
            ? `${connectedCount} connected`
            : HUB_STATUS_LABEL[hubStatus] ?? hubStatus}
        </span>
      </div>

      {showQr ? (
        <>
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-lg border bg-white p-1.5">
              {qr ? (
                <img src={qr} alt="Scan to join on your phone" className="size-[168px]" />
              ) : (
                <div className="flex size-[168px] items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Open this QR with your phone camera to join as a camera + control surface. Both
                devices must reach this same address.
              </p>
              <button
                type="button"
                onClick={() => void copyCode()}
                className="group flex flex-col gap-1 self-start"
                title="Tap to copy"
              >
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Or type the code
                </span>
                <span className="rounded-md border bg-background px-2.5 py-1 font-mono text-lg font-semibold tracking-[0.25em] text-primary group-hover:bg-accent">
                  {session.pairingToken}
                </span>
              </button>
              {copied && <span className="text-xs text-primary">Copied!</span>}
              <Button
                variant="outline"
                size="xs"
                className="self-start"
                onClick={() => void rotatePairing().catch(() => {})}
                disabled={busy}
              >
                <RotateCcw />
                New code
              </Button>
            </div>
          </div>
          <Button variant="ghost" size="xs" className="self-end" onClick={() => setShowQr(false)}>
            Hide
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-1.5"
          onClick={() => setShowQr(true)}
        >
          <Smartphone className="size-3.5" />
          Connect a phone
        </Button>
      )}

      {hubError && <p className="text-xs text-destructive">{hubError}</p>}
    </div>
  );
}
