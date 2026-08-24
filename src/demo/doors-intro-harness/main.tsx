import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { DoorsIntro } from "@/components/setup/DoorsIntro";
import { setAvatarAnchor, fallbackAvatarWindowRect } from "@/lib/avatar-window";

const stageStyle = (() => {
  const r = fallbackAvatarWindowRect();
  return { top: r.top, left: r.left, width: r.size, height: r.size };
})();

/** Dev-only harness: the real DoorsIntro over a fake setup panel, so the
 *  intro can be screenshotted headlessly without auth/presenter. */
function Harness() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      {/* Mimic the real app: screens live in a `relative z-10` wrapper; the
          avatar stage is a fixed opaque z-20 sibling. Before the portal fix
          the doors (z-50 INSIDE the wrapper) painted below the stage. */}
      <div className="relative z-10">
        <div className="flex min-h-svh flex-col items-center justify-start px-4 pb-6 pt-[calc(3.75rem_+_min(36vmin,13rem)_-_2.5rem)]">
          <div
            ref={(el) => {
              setAvatarAnchor(el);
            }}
            className="w-full max-w-[80%] rounded-2xl border bg-card/90 p-5 shadow-xl backdrop-blur-md sm:p-6"
          >
            <div className="flex flex-col gap-1.5 pr-[calc(min(36vmin,13rem)_-_2.5rem_+_1.25rem)]">
              <h2 className="text-xl font-semibold text-primary">
                Getting ready for your call
              </h2>
              <p className="text-sm text-muted-foreground">
                Three quick steps, then we connect you with the ward office.
              </p>
            </div>
            <div className="h-64" />
          </div>
        </div>
      </div>
      <div
        className="fixed z-20 rounded-2xl border-[3px] border-border bg-card shadow-2xl"
        style={stageStyle}
      />
      <DoorsIntro
        onFinish={() => {
          document.title = "intro-finished";
        }}
        onReveal={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
