import { useCallback, useMemo, useState } from "react";
import {
  AudioLines,
  Leaf,
  LifeBuoy,
  Loader2,
  LogOut,
  Menu,
  Mic,
  Moon,
  Scale,
  Settings,
  Smartphone,
  Sun,
  User,
} from "lucide-react";
import { authClient } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/state/theme-context";
import { useTalkMode } from "@/state/talk-mode-context";
import { useSession } from "@/state/session-context";
import { useScannerSetting } from "@/hooks/use-scanner-available";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PhonePairingDialog } from "@/components/session/PhonePairingDialog";
import { AttributionsDialog } from "./AttributionsDialog";
import { cn } from "@/lib/utils";

/** The TagTeam wordmark — Fraunces, two-tone, the signature brand element. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("wordmark", className)}>
      Tag<span className="accent">Team</span>
    </span>
  );
}

/** One-tap light / dark toggle. Shows the icon of the theme you'll switch to. */
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={isDark ? "Light theme" : "Dark theme"}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

/** Hold-to-talk vs voice-activated (VAD) talk mode selector. Lives here so it
 *  can ride both Settings AND the primary surface (§7c.5) — the call screen
 *  renders it right where the user talks. */
export function TalkModeSelector({ compact = false }: { compact?: boolean } = {}) {
  const { talkMode, setTalkMode } = useTalkMode();
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
      {(["ptt", "vad"] as const).map((mode) => {
        const active = talkMode === mode;
        const Icon = mode === "ptt" ? Mic : AudioLines;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => setTalkMode(mode)}
            aria-pressed={active}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md text-sm transition-colors",
              compact ? "px-2 py-1 text-xs" : "px-3 py-1.5",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <Icon className={compact ? "size-3" : "size-3.5"} />
            {mode === "ptt" ? (compact ? "Hold" : "Hold to talk") : compact ? "Voice" : "Voice-activated"}
          </button>
        );
      })}
    </div>
  );
}

/** Help dialog — how the app works + connecting a phone. */
function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="size-4 text-primary" />
            How TagTeam works
          </DialogTitle>
          <DialogDescription>Practice a real Japanese bureaucracy phone call.</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3 text-sm">
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              1
            </span>
            <span>
              <strong>Show us your letter.</strong> Upload a photo of the document you need help
              with, or scan it with your phone.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              2
            </span>
            <span>
              <strong>Set up your call.</strong> Answer a couple of quick questions, then pick your
              goal, difficulty and pace.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              3
            </span>
            <span>
              <strong>Practice the call.</strong> Luna plays the staff member. Hold to talk, or use
              the script when you're stuck. Finish for a cheat sheet.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              4
            </span>
            <span>
              <strong>Connect your phone (optional).</strong> Tap the phone icon up top and scan
              the QR. Use your phone as a camera, mic and remote control.
            </span>
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Tip: real offices often need you to ask <em>「どのように進めればよいですか」</em> (how do I
          proceed?). Luna will help you find the words.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Settings dialog — theme + input + practice defaults live here. */
function SettingsDialog({
  open,
  onOpenChange,
  onAttributions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAttributions: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const [scannerOn, setScannerOn] = useScannerSetting();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="size-4 text-primary" />
            Settings
          </DialogTitle>
          <DialogDescription>Appearance, input and practice preferences.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Theme</p>
            <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
              {(["light", "dark"] as const).map((t) => {
                const Icon = t === "light" ? Sun : Moon;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTheme(t)}
                    aria-pressed={theme === t}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                      theme === t
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {t === "light" ? "Light" : "Dark"}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">How you talk</p>
            <TalkModeSelector />
            <p className="text-xs text-muted-foreground">
              Hold a button while you speak, or let the mic detect your voice automatically
              (Silero VAD runs in your browser. Nothing is recorded until you speak).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={scannerOn}
                onChange={(e) => setScannerOn(e.target.checked)}
                className="size-4 accent-primary"
              />
              Document scanner connected
            </label>
            <p className="text-xs text-muted-foreground">
              Reveals the <em>Scan</em> action on the main screen for capturing pages from your
              scanner.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Practice</p>
            <p className="text-xs text-muted-foreground">
              Difficulty, pace and who answers the phone are chosen per call in the setup step.
              More defaults are coming.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start gap-1.5 self-start text-muted-foreground"
            onClick={onAttributions}
          >
            <Scale className="size-3.5" />
            Open source attributions
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** User badge — initials avatar + a small dropdown with sign-out. */
function UserBadge() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const email = session?.user?.email ?? "";
  const name = session?.user?.name ?? "";
  const initials = useMemo(() => {
    const source = name.trim() || email;
    const parts = source.split(/[\s@._]+/).filter(Boolean);
    return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  }, [name, email]);

  const handleSignOut = useCallback(() => {
    setSigningOut(true);
    void authClient.signOut().finally(() => setSigningOut(false));
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-2 text-sm transition-colors hover:bg-accent/50"
        aria-label="Account menu"
        aria-expanded={open}
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initials}
        </span>
        <span className="max-w-20 truncate text-xs text-muted-foreground sm:max-w-28 sm:inline">
          {name || email || "Account"}
        </span>
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close account menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-1 flex min-w-56 flex-col overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
            <div className="flex flex-col gap-0.5 px-2.5 py-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <User className="size-3.5 text-muted-foreground" />
                {name || "Account"}
              </span>
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              {signingOut ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

type AppHeaderProps = {
  /** Wordmark click target — navigate back to setup. */
  onHome?: () => void;
  /** Scenario/context title shown beside the wordmark (e.g. on the call screen). */
  title?: React.ReactNode;
  /** Extra right-side controls (call-screen device badge / motion browser). */
  right?: React.ReactNode;
};

/** The persistent app frame: wordmark + phone pairing + help + settings + theme + user badge. */
export function AppHeader({ onHome, title, right }: AppHeaderProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attributionsOpen, setAttributionsOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const { devices } = useSession();
  const phoneConnected = devices.some((d) => d.connected);

  return (
    <header className="relative z-20 flex items-center justify-between gap-3 border-b bg-card px-4 py-2.5 print:hidden">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onHome}
          className="flex items-center gap-2 text-primary"
          aria-label="Back to setup"
        >
          <Leaf className="size-5" />
          <Wordmark className="text-xl" />
        </button>
        {title && (
          <span className="hidden max-w-52 truncate text-sm font-medium text-muted-foreground sm:inline">
            {title}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {right}
        {/* Connect a phone — wiggles until a companion joins. */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setPairOpen(true)}
          aria-label="Connect your phone"
          title="Connect your phone"
          className="relative"
        >
          <Smartphone className={cn("size-4", !phoneConnected && "animate-wiggle")} />
          <span
            className={cn(
              "absolute right-1.5 top-1.5 size-1.5 rounded-full",
              phoneConnected ? "bg-primary" : "bg-muted-foreground/50",
            )}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setHelpOpen(true)}
          aria-label="Help"
          title="Help"
        >
          <LifeBuoy className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings"
        >
          <Menu className="size-4" />
        </Button>
        <ThemeToggle />
        <UserBadge />
      </div>

      <PhonePairingDialog open={pairOpen} onOpenChange={setPairOpen} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onAttributions={() => {
          setSettingsOpen(false);
          setAttributionsOpen(true);
        }}
      />
      <AttributionsDialog open={attributionsOpen} onOpenChange={setAttributionsOpen} />
    </header>
  );
}