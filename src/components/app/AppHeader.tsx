import { useCallback, useMemo, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  Leaf,
  LifeBuoy,
  Loader2,
  LogOut,
  Mic,
  Monitor,
  Moon,
  Scale,
  Settings,
  Sun,
  User,
} from "lucide-react";
import { authClient } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/state/theme-context";
import { useTalkMode } from "@/state/talk-mode-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const THEME_LABEL = {
  light: "Light",
  dark: "Dark",
  system: "System",
} as const;

/** Light / Dark / System selector used in the header + settings dialog. */
export function ThemeSelector({ align = "right" }: { align?: "left" | "right" }) {
  const { theme, resolved, setTheme } = useTheme();
  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Theme: ${THEME_LABEL[theme]}`}
        aria-expanded={open}
      >
        <Icon className="size-4" />
        <span className="hidden sm:inline">{THEME_LABEL[theme]}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </Button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close theme menu"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              "absolute z-50 mt-1 flex min-w-32 flex-col overflow-hidden rounded-lg border bg-popover p-1 shadow-lg",
              align === "right" ? "right-0" : "left-0",
            )}
          >
            {(["light", "dark", "system"] as const).map((t) => {
              const Icon = t === "system" ? Monitor : t === "dark" ? Moon : Sun;
              const active = theme === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTheme(t);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-foreground hover:bg-accent",
                  )}
                >
                  <Icon className="size-3.5" />
                  {THEME_LABEL[t]}
                  {t === "system" && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {resolved === "dark" ? "dark" : "light"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Hold-to-talk vs voice-activated (VAD) talk mode selector. */
function TalkModeSelector() {
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
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <Icon className="size-3.5" />
            {mode === "ptt" ? "Hold to talk" : "Voice-activated"}
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
              with, or describe the issue in your own words.
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
              <strong>Connect your phone (optional).</strong> Open <em>Connect a phone</em> on the
              desktop and scan the QR — use your phone as a camera, mic and remote control.
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

/** Settings dialog — theme + practice defaults live here. */
function SettingsDialog({
  open,
  onOpenChange,
  onAttributions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAttributions: () => void;
}) {
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
            <ThemeSelector align="left" />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">How you talk</p>
            <TalkModeSelector />
            <p className="text-xs text-muted-foreground">
              Hold a button while you speak, or let the mic detect your voice automatically
              (Silero VAD runs in your browser — nothing is recorded until you speak).
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
        <ChevronDown className="size-3.5 opacity-60" />
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

/** The persistent app frame: wordmark + help + settings + theme + user badge. */
export function AppHeader({ onHome, title, right }: AppHeaderProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attributionsOpen, setAttributionsOpen] = useState(false);

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
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setHelpOpen(true)}>
          <LifeBuoy className="size-4" />
          <span className="hidden sm:inline">Help</span>
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
          <Settings className="size-4" />
          <span className="hidden sm:inline">Settings</span>
        </Button>
        <ThemeSelector />
        <UserBadge />
      </div>

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
