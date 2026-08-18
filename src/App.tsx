import { Leaf, Loader2 } from "lucide-react";
import { AppStoreProvider, useAppStore } from "@/state/app-store";
import { AvatarProvider } from "@/state/avatar-context";
import { useAuth } from "@/hooks/use-auth";
import { authClient } from "@/lib/auth";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { AvatarStage } from "@/components/stage/AvatarStage";
import { AvatarOverlay } from "@/components/stage/AvatarOverlay";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { CallScreen } from "@/components/call/CallScreen";
import { CheatSheetView } from "@/components/cheat-sheet/CheatSheetView";

function AppContent() {
  const { state, toSetup, reset } = useAppStore();
  const { session } = useAuth();

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      {/* The star is always present behind everything. */}
      <AvatarStage />
      {/* Floating controls on top of the screens (sound toggle + guide). */}
      <AvatarOverlay />

      <div className="relative z-10">
        {state.screen !== "call" && (
          <header className="flex items-center justify-between border-b bg-card px-4 py-2.5 print:hidden">
            <button
              type="button"
              onClick={toSetup}
              className="flex items-center gap-2 text-primary"
            >
              <Leaf className="size-5" />
              <span className="text-base font-semibold">TagTeam</span>
            </button>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground sm:block">
                {session?.user.email}
              </span>
              <button
                type="button"
                onClick={() => void authClient.signOut()}
                className="text-xs font-medium text-muted-foreground hover:text-destructive"
              >
                Sign out
              </button>
            </div>
          </header>
        )}

        {state.screen === "setup" && <SetupScreen />}
        {state.screen === "call" && <CallScreen />}
        {state.screen === "cheat-sheet" &&
          (state.cheatSheet ? (
            <div className="ml-auto flex min-h-svh w-full max-w-3xl flex-col justify-center px-4 py-8 pr-4 md:pr-12">
              <CheatSheetView sheet={state.cheatSheet} onRestart={reset} />
            </div>
          ) : (
            <div className="flex min-h-svh items-center justify-center text-muted-foreground">
              Preparing cheat sheet…
            </div>
          ))}
      </div>
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

  return (
    <AppStoreProvider>
      <AvatarProvider>
        <AppContent />
      </AvatarProvider>
    </AppStoreProvider>
  );
}

export default App;
