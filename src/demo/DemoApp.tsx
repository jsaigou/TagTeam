import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { usePresenter } from "@/hooks/use-presenter";
import {
  demoAvatarMotions,
  demoAvatars,
  demoConnectToken,
  demoScenes,
  demoVoices,
} from "@/demo/api";
import type { CatalogItem, MotionAsset } from "@/lib/api";
import type { CameraAngle, Presenter } from "@/lib/presenter";
import {
  resolveDefaults,
  type RoleSelection,
} from "@/lib/presets";
import {
  Section,
  SegmentGroup,
  SelectField,
  Slider,
  Toggle,
} from "@/demo/ui";

// ── Keyframes (demo-local — never touches the real app's styles) ───────────

const DEMO_KEYFRAMES = `
@keyframes tagteam-walk-traverse {
  0%   { transform: translateX(-15vw) translateY(0) rotate(-1.5deg); }
  12.5%{ transform: translateX(16vw) translateY(-12px) rotate(1deg); }
  25%  { transform: translateX(32vw) translateY(0) rotate(-1.5deg); }
  37.5%{ transform: translateX(48vw) translateY(-12px) rotate(1deg); }
  50%  { transform: translateX(64vw) translateY(0) rotate(-1.5deg); }
  62.5%{ transform: translateX(80vw) translateY(-12px) rotate(1deg); }
  75%  { transform: translateX(96vw) translateY(0) rotate(-1.5deg); }
  87.5%{ transform: translateX(112vw) translateY(-12px) rotate(1deg); }
  100% { transform: translateX(115vw) translateY(0) rotate(-1.5deg); }
}
@keyframes tagteam-walk-bob {
  0%   { transform: translateY(0) rotate(-1deg); }
  50%  { transform: translateY(-14px) rotate(1deg); }
  100% { transform: translateY(0) rotate(-1deg); }
}
`;

// ── Overlay helpers ─────────────────────────────────────────────────────────

type OverlayType = "none" | "solid" | "gradient" | "vignette" | "blur";

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function overlayStyle(type: OverlayType, amount: number, color: string): CSSProperties {
  const a = amount / 100;
  switch (type) {
    case "solid":
      return { background: hexToRgba(color, a) };
    case "gradient":
      return {
        background: `linear-gradient(180deg, ${hexToRgba(color, a)} 0%, transparent 50%, ${hexToRgba(color, a)} 100%)`,
      };
    case "vignette": {
      const inner = Math.max(15, 55 - amount / 2);
      return {
        background: `radial-gradient(ellipse at center, transparent ${inner}%, rgba(0,0,0,${a * 0.95}) 100%)`,
      };
    }
    case "blur":
      return { backdropFilter: `blur(${(amount / 100) * 30}px)` };
    default:
      return {};
  }
}

// ── Main demo app ───────────────────────────────────────────────────────────

type ResizeMode = "container" | "scale" | "camera";
type WalkMode = "traverse" | "bob";

export function DemoApp() {
  const stageRef = useRef<HTMLDivElement>(null);
  const presenter = usePresenter({ stageRef });

  const [catalogState, setCatalogState] = useState<{
    avatars: CatalogItem[];
    scenes: CatalogItem[];
    voices: CatalogItem[];
    isLoading: boolean;
    error: Error | null;
  }>({ avatars: [], scenes: [], voices: [], isLoading: true, error: null });
  const [launchError, setLaunchError] = useState<string | null>(null);

  const [selection, setSelection] = useState<RoleSelection | null>(null);
  const [motions, setMotions] = useState<MotionAsset[]>([]);
  const [motionId, setMotionId] = useState<string>("");

  const [resizeMode, setResizeMode] = useState<ResizeMode>("container");
  const [sizePct, setSizePct] = useState(100);
  const [scaleVal, setScaleVal] = useState(1);
  const [camDistance, setCamDistance] = useState(1);
  const [camAngle, setCamAngle] = useState<"fullbody" | "halfbody">("fullbody");

  const [walkOn, setWalkOn] = useState(false);
  const [walkMode, setWalkMode] = useState<WalkMode>("traverse");
  const [walkDurMs, setWalkDurMs] = useState(8000);
  const [loopMotion, setLoopMotion] = useState(false);

  const [overlayType, setOverlayType] = useState<OverlayType>("none");
  const [overlayAmount, setOverlayAmount] = useState(35);
  const [overlayColor, setOverlayColor] = useState("#0b1220");

  // Load the Connect catalog via the unauthenticated demo API (no login).
  useEffect(() => {
    let cancelled = false;
    Promise.all([demoAvatars(), demoScenes(), demoVoices()])
      .then(([avatars, scenes, voices]) => {
        if (cancelled) return;
        setCatalogState({
          avatars: avatars.items,
          scenes: scenes.items,
          voices: voices.items,
          isLoading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setCatalogState((c) => ({
          ...c,
          isLoading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // presenter's methods are stable (useCallback [] in usePresenter), but the
  // returned object is recreated each render — destructure the stable refs.
  const { initialize: presenterInitialize } = presenter;

  const launch = useCallback(
    (next: RoleSelection) => {
      setSelection(next);
      setLaunchError(null);
      void (async () => {
        try {
          const { connect_token } = await demoConnectToken();
          await presenterInitialize(connect_token, next);
        } catch (err) {
          setLaunchError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [presenterInitialize],
  );

  // Auto-launch once the catalog resolves, using the curated defaults.
  const didAutoLaunch = useRef(false);
  useEffect(() => {
    if (catalogState.isLoading || catalogState.error) return;
    const defaults = resolveDefaults(
      catalogState.avatars,
      catalogState.scenes,
      catalogState.voices,
    );
    if (!defaults || didAutoLaunch.current) return;
    didAutoLaunch.current = true;
    launch(defaults);
  }, [catalogState, launch]);

  // Motion catalog for the launched avatar (walk garnish).
  useEffect(() => {
    if (!selection?.avatarId) return;
    let cancelled = false;
    demoAvatarMotions(selection.avatarId)
      .then(({ items }) => {
        if (cancelled) return;
        setMotions(items);
        setMotionId(items[0]?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) setMotions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selection?.avatarId]);

  // Perxona-native "resize": camera FOV distance. Applies to the widget via a
  // direct element query — the demo avoids touching the shared presenter hook.
  useEffect(() => {
    if (!presenter.ready) return;
    const el = stageRef.current?.querySelector<Presenter>("sv-presenter");
    el?.updateCameraFOV({ distance: camDistance, vertical: 0, horizontal: 4.5 });
  }, [presenter.ready, camDistance, stageRef]);

  // Loop a real avatar motion underneath the walk to sell the gait.
  useEffect(() => {
    if (!loopMotion || !walkOn || !motionId) return;
    const interval = window.setInterval(() => {
      void presenter.playMotion(motionId).catch(() => {});
    }, 2600);
    return () => window.clearInterval(interval);
  }, [loopMotion, walkOn, motionId, presenter]);

  const sayHi = async () => {
    try {
      await presenter.resumeAudio();
      await presenter.present("こんにちは！よろしくお願いします。", { emotion: "joy" });
    } catch {
      /* presenter not ready / audio still locked — button keeps working */
    }
  };

  // ── Stage sizing ──────────────────────────────────────────────────────────
  const outerStyle: CSSProperties = { width: "100%", height: "100%" };
  if (resizeMode === "container") {
    outerStyle.width = `${sizePct}%`;
    outerStyle.height = `${sizePct}%`;
  } else if (resizeMode === "scale") {
    outerStyle.transform = `scale(${scaleVal})`;
  }
  const stageStyle: CSSProperties = walkOn
    ? {
        animation: `tagteam-walk-${walkMode} ${walkDurMs}ms linear infinite`,
      }
    : {};

  return (
    <div className="relative h-svh w-full overflow-hidden bg-black">
      <style>{DEMO_KEYFRAMES}</style>

      {/* ── Stage ─────────────────────────────────────────────────────── */}
      <div className="absolute inset-0 grid place-items-center overflow-hidden">
        <div className="relative overflow-visible" style={outerStyle}>
          <div
            ref={stageRef}
            className="h-full w-full"
            style={stageStyle}
          />
        </div>
      </div>

      {/* ── Front layer (above the avatar) ────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={overlayStyle(overlayType, overlayAmount, overlayColor)}
      />

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 py-3">
        <div className="rounded-md border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur">
          Avatar effects demo
          <span className="ml-2 text-zinc-500">
            <a
              href="/"
              className="pointer-events-auto text-lime-400 underline-offset-2 hover:underline"
            >
              back to TagTeam
            </a>
          </span>
        </div>
        <button
          type="button"
          onClick={sayHi}
          disabled={!presenter.ready}
          className="pointer-events-auto rounded-md bg-lime-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Say hi
        </button>
      </div>

      {/* ── Control panel ─────────────────────────────────────────────── */}
      <aside className="absolute inset-y-0 right-0 z-20 w-80 overflow-y-auto border-l border-white/10 bg-zinc-950/80 text-sm text-zinc-200 backdrop-blur">
        <div className="border-b border-white/10 px-4 py-3">
          <p className="text-xs font-semibold text-zinc-100">Presenter status</p>
          <p className="mt-1 text-xs text-zinc-400">
            {catalogState.error
              ? "Demo API unavailable — run `pnpm dev` (not production) so /api/demo/* is registered."
              : catalogState.isLoading
                ? "Loading catalog…"
                : launchError
                  ? "Launch failed: " + launchError
                  : presenter.ready
                    ? "Ready ✓ (avatar id " + (selection?.avatarId.slice(0, 8) ?? "—") + ")"
                    : presenter.loadError
                      ? "Presenter failed to load"
                      : "Waking the avatar…"}
          </p>
        </div>

        <Section title="Launch">
          <SelectField
            label="Avatar"
            value={selection?.avatarId ?? ""}
            options={catalogState.avatars.map((a) => ({ value: a.id, label: a.name }))}
            onChange={(v) => launch({ ...(selection ?? {}), avatarId: v } as RoleSelection)}
          />
          <SelectField
            label="Scene"
            value={selection?.sceneId ?? ""}
            options={catalogState.scenes.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(v) => launch({ ...(selection ?? {}), sceneId: v } as RoleSelection)}
          />
          <SelectField
            label="Voice"
            value={selection?.voiceId ?? ""}
            options={catalogState.voices.map((v) => ({ value: v.id, label: v.name }))}
            onChange={(v) => launch({ ...(selection ?? {}), voiceId: v } as RoleSelection)}
          />
          <button
            type="button"
            disabled={!selection || catalogState.isLoading}
            onClick={() => selection && launch(selection)}
            className="rounded-md bg-lime-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Relaunch avatar
          </button>
        </Section>

        <Section title="1 · Resize">
          <SegmentGroup<ResizeMode>
            label="Method"
            value={resizeMode}
            onChange={setResizeMode}
            options={[
              { value: "container", label: "Container" },
              { value: "scale", label: "CSS scale" },
              { value: "camera", label: "Camera FOV" },
            ]}
          />
          {resizeMode === "container" && (
            <Slider
              label="Size"
              value={sizePct}
              min={40}
              max={100}
              step={1}
              format={(v) => `${v}%`}
              onChange={setSizePct}
            />
          )}
          {resizeMode === "scale" && (
            <Slider
              label="Scale"
              value={scaleVal}
              min={0.5}
              max={2}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={setScaleVal}
            />
          )}
          {resizeMode === "camera" && (
            <Slider
              label="Distance"
              value={camDistance}
              min={0.4}
              max={3}
              step={0.1}
              format={(v) => `${v.toFixed(1)}`}
              onChange={setCamDistance}
            />
          )}
          <SegmentGroup<"fullbody" | "halfbody">
            label="Camera angle (Perxona)"
            value={camAngle}
            onChange={(v) => {
              setCamAngle(v);
              presenter.updateCameraAngle(v as CameraAngle);
            }}
            options={[
              { value: "fullbody", label: "Fullbody" },
              { value: "halfbody", label: "Halfbody" },
            ]}
          />
          <p className="text-[11px] leading-snug text-zinc-500">
            Container &amp; scale are CSS — the widget re-fits on container size changes
            (ResizeObserver) but not on transform scale. Camera FOV is Perxona-native zoom.
          </p>
        </Section>

        <Section title="2 · Walk">
          <Toggle label="Walk" checked={walkOn} onChange={setWalkOn} />
          <SegmentGroup<WalkMode>
            label="Style"
            value={walkMode}
            onChange={(v) => {
              setWalkMode(v);
              setWalkDurMs(v === "bob" ? 1300 : 8000);
            }}
            options={[
              { value: "traverse", label: "Traverse" },
              { value: "bob", label: "Bob in place" },
            ]}
          />
          <Slider
            label="Speed"
            value={walkDurMs}
            min={walkMode === "bob" ? 400 : 2000}
            max={walkMode === "bob" ? 3000 : 16000}
            step={100}
            format={(v) => `${(v / 1000).toFixed(1)}s`}
            onChange={setWalkDurMs}
          />
          {motions.length > 0 && (
            <>
              <SelectField
                label="Loop a real motion under the walk"
                value={motionId}
                options={motions.map((m) => ({ value: m.id, label: m.name }))}
                onChange={setMotionId}
              />
              <Toggle
                label="Loop motion while walking"
                checked={loopMotion}
                onChange={setLoopMotion}
              />
            </>
          )}
          <p className="text-[11px] leading-snug text-zinc-500">
            Perxona has no walk motion. The scene is composited inside the widget, so
            traversing moves the backdrop with the avatar — bob-in-place keeps it still.
          </p>
        </Section>

        <Section title="3 · Front layer">
          <SegmentGroup<OverlayType>
            label="Layer"
            value={overlayType}
            onChange={setOverlayType}
            options={[
              { value: "none", label: "None" },
              { value: "solid", label: "Solid tint" },
              { value: "gradient", label: "Gradient" },
              { value: "vignette", label: "Vignette" },
              { value: "blur", label: "Frost" },
            ]}
          />
          {overlayType !== "none" && (
            <>
              <Slider
                label={overlayType === "blur" ? "Blur" : "Opacity"}
                value={overlayAmount}
                min={0}
                max={100}
                step={1}
                format={(v) => (overlayType === "blur" ? `${Math.round((v / 100) * 30)}px` : `${v}%`)}
                onChange={setOverlayAmount}
              />
              {overlayType !== "vignette" && overlayType !== "blur" && (
                <label className="flex items-center justify-between text-xs text-zinc-300">
                  <span>Color</span>
                  <input
                    type="color"
                    value={overlayColor}
                    onChange={(e) => setOverlayColor(e.target.value)}
                    className="h-6 w-12 cursor-pointer rounded border border-zinc-700 bg-transparent"
                  />
                </label>
              )}
            </>
          )}
          <p className="text-[11px] leading-snug text-zinc-500">
            A plain stacking layer above the WebGL canvas. Frost uses backdrop-filter
            blur — a real blur of the avatar, not a fake.
          </p>
        </Section>
      </aside>
    </div>
  );
}
