import { Leaf } from "lucide-react";
import { AppStoreProvider, useAppStore } from "@/state/app-store";
import { AvatarProvider } from "@/state/avatar-context";
import { AvatarStage } from "@/components/stage/AvatarStage";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { CallScreen } from "@/components/call/CallScreen";
import { CheatSheetView } from "@/components/cheat-sheet/CheatSheetView";

function Shell() {
  const { state, toSetup, reset } = useAppStore();

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      {/* The star is always present behind everything. */}
      <AvatarStage />

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
  return (
    <AppStoreProvider>
      <AvatarProvider>
        <Shell />
      </AvatarProvider>
    </AppStoreProvider>
  );
}

export default App;
