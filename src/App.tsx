import { Loader2 } from "lucide-react";
import { AppStoreProvider, useAppStore } from "@/state/app-store";
import { SessionProvider } from "@/state/session-context";
import { AvatarProvider } from "@/state/avatar-context";
import { useAuth } from "@/hooks/use-auth";
import { isPhoneJoinUrl } from "@/lib/session-utils";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { AvatarStage } from "@/components/stage/AvatarStage";
import { AppHeader } from "@/components/app/AppHeader";
import { AppFooter } from "@/components/app/AppFooter";
import { CallHeaderControls } from "@/components/call/CallHeaderControls";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { CallScreen } from "@/components/call/CallScreen";
import { PrepScreen } from "@/components/prep/PrepScreen";
import { CheatSheetView } from "@/components/cheat-sheet/CheatSheetView";
import { PhoneApp } from "@/components/phone/PhoneApp";

function AppContent() {
  const { state, toSetup, reset } = useAppStore();

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      {/* Luna lives in her top-right corner window; the door intro reveals
          her there, and the call screen expands the stage full-screen. */}
      <AvatarStage />

      <AppHeader
        onHome={toSetup}
        title={state.screen === "call" ? state.script?.scenarioTitle : undefined}
        right={state.screen === "call" ? <CallHeaderControls /> : undefined}
      />

      <div className="relative z-10">
        {state.screen === "setup" && <SetupScreen />}
        {/* The briefing between research delivery and the call. A direct nav
            without a script falls back to the setup screen. */}
        {state.screen === "prep" && (state.script ? <PrepScreen /> : <SetupScreen />)}
        {state.screen === "call" && <CallScreen />}
        {state.screen === "cheat-sheet" &&
          (state.cheatSheet ? (
            <div className="flex min-h-svh w-full flex-col items-center justify-start px-4 pb-8 pt-[calc(3.75rem_+_min(36vmin,13rem)_+_1.5rem)] xl:justify-center xl:pr-12 xl:pt-8">
              <div className="w-full max-w-3xl">
                <CheatSheetView sheet={state.cheatSheet} onRestart={reset} />
              </div>
            </div>
          ) : (
            <div className="flex min-h-svh items-center justify-center text-muted-foreground">
              Preparing cheat sheet…
            </div>
          ))}
      </div>

      {/* §7c.1 — the missing app-level footer (Terms / Privacy / Attributions).
          Never over the in-call stage. */}
      {state.screen !== "call" && <AppFooter />}
    </div>
  );
}

function App() {
  const { session, isPending } = useAuth();

  /* The app is gated behind a better-auth session. The presenter mounts only
     after login (it needs a minted connect token, which requires auth). */
  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (!session) return <LoginScreen />;

  const phoneMode = isPhoneJoinUrl(window.location.pathname, window.location.hash);

  return (
    <AppStoreProvider>
      <SessionProvider>
        {phoneMode ? (
          <PhoneApp />
        ) : (
          <AvatarProvider>
            <AppContent />
          </AvatarProvider>
        )}
      </SessionProvider>
    </AppStoreProvider>
  );
}

export default App;
