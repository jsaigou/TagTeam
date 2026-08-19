import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { usePresenter } from "@/hooks/use-presenter";
import {
  demoAvatars,
  demoConnectToken,
  demoScenes,
  demoVoices,
} from "@/demo/api";
import type { CatalogItem } from "@/lib/api";
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
import {
  computeStory,
  STORY_END,
  type PhaseId,
  type SceneState,
  type StoryOpts,
} from "./story";

// ── Luna's wave (verified live — same id the real app uses). ────────────────

const WAVE_MOTION = "01KD2H5BX9MXDJA5T9QY83QYS3";

const IDLE_SCENE = computeStory(0, { bobAmp: 9, bobMs: 1100 });

// Phase → representative paused pose for the stepper buttons.
const PHASE_POSES: Record<PhaseId, number> = {
  idle: 1200,
  approach: 5000,
  descend: 7600,
  door: 8800,
  wave: 10500,
  slide: 11900,
  zoom: 13000,
  indoor: 14800,
  end: STORY_END,
};

// ── Main demo ───────────────────────────────────────────────────────────────

export function HouseDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const presenter = usePresenter({ stageRef });
  const { initialize: presenterInitialize, playMotion, updateCameraAngle } = presenter;

  const [catalogState, setCatalogState] = useState<{
    avatars: CatalogItem[];
    scenes: CatalogItem[];
    voices: CatalogItem[];
    isLoading: boolean;
    error: Error | null;
  }>({ avatars: [], scenes: [], voices: [], isLoading: true, error: null });
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [selection, setSelection] = useState<RoleSelection | null>(null);

  const [scene, setScene] = useState<SceneState>(IDLE_SCENE);
  const [playing, setPlaying] = useState(false);

  // Manual effect tweaks (used when paused, and by the story via opts).
  const [bobAmp, setBobAmp] = useState(9);
  const [bobMs, setBobMs] = useState(1100);

  const optsRef = useRef<StoryOpts>({ bobAmp, bobMs });
  optsRef.current = { bobAmp, bobMs };

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

  // Auto-launch Luna once the catalog resolves.
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

  // Story timeline — drive the scene at animation-frame rate while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      setScene(computeStory(elapsed, optsRef.current));
      if (elapsed < STORY_END) {
        raf = requestAnimationFrame(tick);
      } else {
        setPlaying(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Apply FOV (the widened Perxona-native zoom) whenever it changes.
  useEffect(() => {
    if (!presenter.ready) return;
    const el = stageRef.current?.querySelector<Presenter>("sv-presenter");
    el?.updateCameraFOV({ distance: scene.fov, vertical: 0, horizontal: 4.5 });
  }, [scene.fov, presenter.ready, stageRef]);

  // Apply the camera angle at transitions (halfbody for the closing close-up).
  useEffect(() => {
    if (!presenter.ready) return;
    updateCameraAngle(scene.camAngle as CameraAngle);
  }, [scene.camAngle, presenter.ready, updateCameraAngle]);

  // Loop the wave while the scene asks for it (window idle + closing pose).
  useEffect(() => {
    if (!scene.wave || !presenter.ready) return;
    const interval = window.setInterval(() => {
      void playMotion(WAVE_MOTION).catch(() => {});
    }, 3200);
    return () => window.clearInterval(interval);
  }, [scene.wave, presenter.ready, playMotion]);

  const patchScene = useCallback(
    (patch: Partial<SceneState>) => setScene((s) => ({ ...s, ...patch })),
    [],
  );

  const jumpToPhase = (phase: PhaseId) => {
    setPlaying(false);
    setScene(computeStory(PHASE_POSES[phase], optsRef.current));
  };

  const worldStyle: CSSProperties = {
    transform: `translateX(${scene.tx}px) translateY(${scene.bobY}px) scale(${scene.worldScale})`,
  };
  const avatarStyle: CSSProperties = {
    left: scene.avatar.left,
    top: scene.avatar.top,
    width: scene.avatar.width,
    height: scene.avatar.height,
    opacity: scene.avatar.opacity,
    zIndex: scene.avatar.z,
  };
  const doorStyle: CSSProperties = {
    transform: `rotateY(${scene.doorDeg}deg)`,
  };

  const catalogReady = !catalogState.isLoading && !catalogState.error;

  return (
    <div className="relative h-svh w-full overflow-hidden bg-sky-950">
      {/* ── Stage (the world is transformed as a whole) ──────────────── */}
      <div className="absolute inset-0 grid place-items-center overflow-hidden">
        <div className="house-world" style={worldStyle}>
          {/* backdrop — BEHIND the avatar card, fades with the house */}
          <div className="house-backdrop" style={{ opacity: scene.houseOpacity }}>
            <div className="house-sky" />
            <div className="house-ground" />
          </div>

          {/* the house — IN FRONT of the avatar card (occludes except window/door) */}
          <div className="house-env" style={{ opacity: scene.houseOpacity }}>
            <div className="house-facade">
              <div className="hf-strip hf-left" />
              <div className="hf-strip hf-right" />
              <div className="hf-strip hf-top" />
              <div className="hf-strip hf-mid" />
            </div>
            <div className="house-window-frame" />
            <div className="house-window-glass" />
            <div className="house-roof" />
            <div className="house-path" />
            <div className="house-door" style={doorStyle}>
              <div className="house-door-panel" />
            </div>
            <div className="house-bush" />
          </div>

          {/* the avatar (Luna) — mounted into this div by usePresenter */}
          <div ref={stageRef} className="house-avatar" style={avatarStyle} />
        </div>
      </div>

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 py-3">
        <div className="rounded-md border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur">
          House demo — the cat comes to the door
          <span className="ml-2 text-zinc-500">
            <a
              href="/"
              className="pointer-events-auto text-lime-400 underline-offset-2 hover:underline"
            >
              back to TagTeam
            </a>
            <span className="mx-1 text-zinc-600">·</span>
            <a
              href="/demo/"
              className="pointer-events-auto text-lime-400 underline-offset-2 hover:underline"
            >
              primitive demo
            </a>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="pointer-events-auto rounded-md bg-lime-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ▶ Play story
        </button>
      </div>

      {/* ── Control panel ───────────────────────────────────────────── */}
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
                    ? "Ready ✓ — Luna (" + (selection?.avatarId.slice(0, 8) ?? "—") + ")"
                    : presenter.loadError
                      ? "Presenter failed to load"
                      : "Waking Luna…"}
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Phase: <span className="font-medium text-lime-400">{scene.phase}</span>
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

        <Section title="Story">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="rounded-md bg-lime-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {playing ? "Playing…" : "▶ Play story"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setScene(IDLE_SCENE);
              }}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
            >
              Reset
            </button>
          </div>
          <SegmentGroup<PhaseId>
            label="Jump to phase"
            value={scene.phase}
            onChange={jumpToPhase}
            options={[
              { value: "idle", label: "Window" },
              { value: "approach", label: "Approach" },
              { value: "door", label: "Door" },
              { value: "wave", label: "Wave" },
              { value: "slide", label: "Slide" },
              { value: "zoom", label: "Zoom" },
              { value: "indoor", label: "Indoor" },
              { value: "end", label: "End" },
            ]}
          />
          <p className="text-[11px] leading-snug text-zinc-500">
            Only the cat's upper body shows through the window (the wall hides her
            legs). Approach = scale + bob + traverse. The cat then descends hidden
            behind the wall, the door opens with her already there, she waves, slides
            out of the way, fast zoom to the doorway, and a fade crossfades into a
            full indoor scene. No teleports, window transparency never changes.
          </p>
        </Section>

        <Section title="Effects (paused)">
          <Slider
            label="FOV distance"
            value={scene.fov}
            min={0.1}
            max={10}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => patchScene({ fov: v })}
          />
          <Slider
            label="World scale"
            value={scene.worldScale}
            min={0.6}
            max={3.5}
            step={0.01}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => patchScene({ worldScale: v })}
          />
          <Slider
            label="Traverse X"
            value={scene.tx}
            min={-200}
            max={200}
            step={1}
            format={(v) => `${v}px`}
            onChange={(v) => patchScene({ tx: v })}
          />
          <Slider
            label="Door"
            value={scene.doorDeg}
            min={0}
            max={110}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => patchScene({ doorDeg: v })}
          />
          <Slider
            label="Bob amp"
            value={bobAmp}
            min={0}
            max={20}
            step={0.5}
            format={(v) => `${v}px`}
            onChange={setBobAmp}
          />
          <Slider
            label="Bob speed"
            value={bobMs}
            min={600}
            max={2000}
            step={50}
            format={(v) => `${(v / 1000).toFixed(2)}s`}
            onChange={setBobMs}
          />
          <SegmentGroup<"fullbody" | "halfbody">
            label="Camera angle"
            value={scene.camAngle}
            onChange={(v) => patchScene({ camAngle: v })}
            options={[
              { value: "fullbody", label: "Fullbody" },
              { value: "halfbody", label: "Halfbody" },
            ]}
          />
          <Toggle
            label="Wave on loop"
            checked={scene.wave}
            onChange={(v) => patchScene({ wave: v })}
          />
          <p className="text-[11px] leading-snug text-zinc-500">
            FOV now goes 0.1→10 (was 0.4→3). Low distances push into the avatar;
            very high ones shrink it to a dot — the usable range is what you see.
          </p>
        </Section>
      </aside>

      {!catalogReady && !catalogState.error && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <p className="rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm text-zinc-300 backdrop-blur">
            Waking Luna… ({scene.phase})
          </p>
        </div>
      )}
    </div>
  );
}
