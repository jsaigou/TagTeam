import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2, RotateCcw, Smartphone } from "lucide-react";
import { useSession } from "@/state/session-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const HUB_STATUS_LABEL: Record<string, string> = {
  idle: "Waiting",
  connecting: "Connecting…",
  open: "Connected",
  closed: "Disconnected",
};

/** Desktop QR pairing dialog (reachable from the header phone icon and the
 *  setup-screen "Scan with smartphone" action). The phone scans the QR — or
 *  types the 6-char code — to join as a camera + control surface. */
export function PhonePairingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { session, hubStatus, devices, hubError, rotatePairing } = useSession();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const connectedCount = devices.filter((d) => d.connected).length;
  const busy = hubStatus === "connecting";

  useEffect(() => {
    if (!open || !session?.joinUrl) return;
    let active = true;
    setQr(null);
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
  }, [open, session?.joinUrl]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-4 text-primary" />
            Connect a phone
          </DialogTitle>
          <DialogDescription>
            Use your phone as a camera, mic and remote control for the call.
          </DialogDescription>
        </DialogHeader>

        {!session ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Starting phone session…
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
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
                  Open this QR with your phone camera to join as a camera + control
                  surface. Both devices must reach this same address.
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

            {hubError && <p className="text-xs text-destructive">{hubError}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}