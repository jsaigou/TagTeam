import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AttributionsDialog } from "./AttributionsDialog";

/**
 * The app-level footer (Phase 7 plan §7c.1): Terms, Privacy, and the
 * Attributions dialog — previously reachable only from Settings. Rendered on
 * the setup and cheat-sheet screens (never over the in-call stage).
 *
 * The copy is deliberately short, factual summaries of what the app actually
 * does (ephemeral document handling, per-account scenario storage) rather
 * than boilerplate legalese.
 */
export function AppFooter() {
  const [tosOpen, setTosOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [attributionsOpen, setAttributionsOpen] = useState(false);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-center gap-1 bg-gradient-to-t from-background/80 to-transparent px-4 pb-2 pt-4 text-xs text-muted-foreground">
      <span className="sr-only sm:not-sr-only">TagTeam</span>
      <span aria-hidden className="hidden sm:inline">
        ·
      </span>
      <button
        type="button"
        onClick={() => setTosOpen(true)}
        className="underline-offset-2 hover:text-foreground hover:underline"
      >
        Terms
      </button>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={() => setPrivacyOpen(true)}
        className="underline-offset-2 hover:text-foreground hover:underline"
      >
        Privacy
      </button>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={() => setAttributionsOpen(true)}
        className="underline-offset-2 hover:text-foreground hover:underline"
      >
        Attributions
      </button>

      <Dialog open={tosOpen} onOpenChange={setTosOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Terms of use</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
                <p>
                  TagTeam is a <strong>practice tool</strong>: it rehearses simulated Japanese
                  phone calls and summarizes information you provide or confirm. It is not an
                  official source. Office hours, required documents, and procedures can change,
                  so always verify details with the agency's official channels before your real
                  call.
                </p>
                <p>
                  AI-generated replies can be wrong. Nothing here constitutes legal or
                  administrative advice, and the service is provided as-is, without warranties.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog open={privacyOpen} onOpenChange={setPrivacyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Privacy</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
                <p>
                  Documents you photograph are processed to summarize them and are then{" "}
                  <strong>deleted within minutes</strong>; they are never persisted.
                </p>
                <p>
                  Your practice scenarios, transcripts, and cheat sheets are stored only under
                  your account on this server so you can revisit past calls. Audio you speak is
                  transcribed to produce replies and is not kept. No data is sold or shared for
                  advertising.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <AttributionsDialog open={attributionsOpen} onOpenChange={setAttributionsOpen} />
    </footer>
  );
}
