import { Leaf, LogOut } from "lucide-react";
import { AppStoreProvider, useAppStore } from "@/state/app-store";
import { useAuth } from "@/hooks/use-auth";
import { Login } from "@/components/setup/Login";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { CallScreen } from "@/components/call/CallScreen";
import { CheatSheetView } from "@/components/cheat-sheet/CheatSheetView";
import { Button } from "@/components/ui/button";

function Shell() {
  const { state, toSetup, reset } = useAppStore();
  const auth = useAuth();

  if (!auth.isAuthenticated) {
    return <Login auth={auth} onSuccess={toSetup} />;
  }

  return (
    <div className="flex min-h-svh flex-col">
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
            <span className="text-xs text-muted-foreground">{auth.email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                auth.logout();
                reset();
              }}
            >
              <LogOut />
              Sign out
            </Button>
          </div>
        </header>
      )}

      {state.screen === "setup" && <SetupScreen />}
      {state.screen === "call" && <CallScreen />}
      {state.screen === "cheat-sheet" &&
        (state.cheatSheet ? (
          <CheatSheetView sheet={state.cheatSheet} onRestart={reset} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Preparing cheat sheet…
          </div>
        ))}
    </div>
  );
}

function App() {
  return (
    <AppStoreProvider>
      <Shell />
    </AppStoreProvider>
  );
}

export default App;
