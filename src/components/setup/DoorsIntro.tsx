import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import {
  computeIntro,
  INTRO_END,
  REVEAL_START,
  STROKE_SPANS,
  STROKES,
  type IntroFrame,
} from "./intro-timeline";
import { useAvatarWindowRect } from "@/hooks/use-avatar-window-rect";import { playKnock } from "@/lib/sfx";

const WALNUT = "linear-gradient(168deg, #6e4a30 0%, #593a2a 55%, #452b21 100%)";
const BRASS =
  "radial-gradient(circle at 35% 30%, #e6c37a 0%, #c89b4a 45%, #8a6a2f 100%)";

/** Bevel lighting: shadow along the hinge side, highlight catching light on
 *  the leading (split) edge — mirrored per leaf. */
const bevelShadow = (left: boolean): string =>
  left
    ? "inset 5px 0 9px rgba(0,0,0,.5), inset -4px 0 7px rgba(255,255,255,.16), inset 0 3px 5px rgba(255,255,255,.08), inset 0 -4px 7px rgba(0,0,0,.4)"
    : "inset -5px 0 9px rgba(0,0,0,.5), inset 4px 0 7px rgba(255,255,255,.16), inset 0 3px 5px rgba(255,255,255,.08), inset 0 -4px 7px rgba(0,0,0,.4)";

interface LeafProps {
  side: "left" | "right";
  /** The wood/brass group whose opacity rides the material beat (target B). */
  textureRef: React.RefObject<HTMLDivElement | null>;
}

/** One hinged door leaf. Invisible while the ink draws (the line art lives in
 *  a single shared SVG above the leaves); its wood layers fade in with the
 *  material beat, then the whole leaf swings around its hinge edge. The root
 *  transform is driven imperatively by the rAF loop (see DoorsIntro). */
const Leaf = forwardRef<HTMLDivElement, LeafProps>(function Leaf(
  { side, textureRef },
  ref,
) {
  const left = side === "left";
  return (
    <div
      ref={ref}
      className="absolute will-change-transform"
      style={{
        top: "9%",
        height: "85%",
        [left ? "left" : "right"]: "9%",
        width: "41%",
        transformOrigin: left ? "left center" : "right center",
        backfaceVisibility: "hidden",
      }}
    >
      {/* Everything that fades in with the material transition (target B). */}
      <div ref={textureRef} className="absolute inset-0" style={{ opacity: 0 }}>
        <div className="absolute inset-0" style={{ background: WALNUT }} />
        <div
          className="absolute inset-0"
          style={{ boxShadow: bevelShadow(left) }}
        />
        {/* Routed panel outline in the wood. */}
        <div
          className="absolute rounded-sm"
          style={{
            left: "14%",
            right: "14%",
            top: "9%",
            height: "46%",
            border: "2px solid rgba(0,0,0,.35)",
            boxShadow: "inset 0 1px 2px rgba(255,255,255,.12)",
          }}
        />
        {/* Brass knob beside the split… */}
        <div
          className="absolute rounded-full"
          style={{
            [left ? "right" : "left"]: "6%",
            top: "68%",
            width: "11%",
            aspectRatio: "1",
            background: BRASS,
            boxShadow:
              "0 1px 3px rgba(0,0,0,.55), inset 0 1px 1px rgba(255,255,255,.5)",
          }}
        />
        {/* …and brass hinges on the frame edge. */}
        {[0.12, 0.62].map((y) => (
          <div
            key={y}
            className="absolute"
            style={{
              [left ? "left" : "right"]: "3%",
              top: `${y * 100}%`,
              width: "5%",
              height: "9%",
              borderRadius: 2,
              background: BRASS,
              boxShadow: "inset 0 1px 1px rgba(255,255,255,.4)",
            }}
          />
        ))}
      </div>
    </div>
  );
});

/** The Get Started reveal (ported from /demo3): a double door draws itself
 *  over Luna's corner window (exactly the avatar-window rect — the stage sits
 *  behind it) like a human hand — one continuous stroke at a time, longest
 *  first, ~1s total — settles into walnut + brass, gets knocked, swings open
 *  onto Luna waving, then fades away. Only then does SetupScreen start her
 *  greeting. Tapping or pressing Enter/Space on the door skips straight to
 *  the end; the rest of the screen stays live underneath.
 *
 *  Per-frame values are pushed to the DOM imperatively (refs, no React
 *  re-render per frame) so the stroke-dashoffset animation never stutters;
 *  React state is reserved for the knock flash. */
export function DoorsIntro({
  onFinish,
  onReveal,
}: {
  /** Sequence finished (`skip` = user dismissed it early). */
  onFinish: (skip: boolean) => void;
  /** Doors are open — wave silently (fires once per run). */
  onReveal: () => void;
}) {
  const [flashing, setFlashing] = useState(false);
  /* Same measured rect the avatar stage uses — the doors draw exactly over
     Luna's attached window (panel-anchored when the setup card is mounted). */
  const rect = useAvatarWindowRect();
  const startRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const knocksRef = useRef(0);
  const revealedRef = useRef(false);
  const doneRef = useRef(false);
  const flashTimerRef = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const jambRef = useRef<HTMLDivElement | null>(null);
  const lineArtRef = useRef<SVGGElement | null>(null);
  const strokeRefs = useRef<(SVGPathElement | null)[]>([]);
  const leafLRef = useRef<HTMLDivElement | null>(null);
  const leafRRef = useRef<HTMLDivElement | null>(null);
  const texLRef = useRef<HTMLDivElement | null>(null);
  const texRRef = useRef<HTMLDivElement | null>(null);

  const finish = useCallback(
    (skip: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(flashTimerRef.current);
      onFinish(skip);
    },
    [onFinish],
  );

  useEffect(() => {
    const applyFrame = (f: IntroFrame) => {
      STROKE_SPANS.forEach((_, i) => {
        const el = strokeRefs.current[i];
        if (!el) return;
        const p = f.strokes[i];
        /* Round caps would leave a dot at offset 1 — hide untouched strokes. */
        el.style.visibility = p <= 0 ? "hidden" : "visible";
        el.style.strokeDashoffset = String(1 - p);
      });
      if (lineArtRef.current) lineArtRef.current.style.opacity = String(1 - f.texture);
      for (const [leaf, tex] of [
        [leafLRef.current, texLRef.current],
        [leafRRef.current, texRRef.current],
      ] as const) {
        if (!leaf) continue;
        const left = leaf === leafLRef.current;
        leaf.style.transform = `perspective(1100px) rotateY(${(left ? -1 : 1) * f.doorDeg}deg)`;
        if (tex) tex.style.opacity = String(f.texture);
      }
      if (jambRef.current) jambRef.current.style.opacity = String(f.jamb);
      if (stageRef.current) stageRef.current.style.opacity = String(f.opacity);
    };

    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const t = now - startRef.current;
      const next = computeIntro(t);
      applyFrame(next);
      if (next.knocks > knocksRef.current) {
        knocksRef.current = next.knocks;
        playKnock();
        setFlashing(true);
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => setFlashing(false), 120);
      }
      if (!revealedRef.current && t >= REVEAL_START) {
        revealedRef.current = true;
        onReveal();
      }
      if (t >= INTRO_END) {
        finish(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(flashTimerRef.current);
    };
  }, [finish, onReveal]);

  return (
    <div
      ref={stageRef}
      role="button"
      tabIndex={0}
      aria-label="Luna's door is opening — tap to skip"
      className="fixed z-50 cursor-pointer select-none overflow-hidden rounded-2xl outline-none"
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.size,
        height: rect.size,
        opacity: 1,
        boxShadow: "0 12px 32px rgba(0,0,0,.35)",
      }}
      onPointerDown={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") finish(true);
      }}
    >
      {/* Opaque backing matching the page background — hides the avatar
          (and her loading state) behind the doorway from frame zero; fades
          only as the leaves part (driven imperatively). */}
      <div ref={jambRef} className="absolute inset-0 bg-background" />

      <Leaf ref={leafLRef} side="left" textureRef={texLRef} />
      <Leaf ref={leafRRef} side="right" textureRef={texRRef} />

      {/* The single-hand ink pass (target A): ONE shared square viewBox at
          uniform scale, paths only (no <rect> dash quirks), dashoffset driven
          imperatively per frame. Knock flash brightens the fresh walnut via
          a CSS filter on the leaves' container below. */}
      <svg
        viewBox="0 0 400 400"
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      >
        <g
          ref={lineArtRef}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={4}
          stroke="var(--primary)"
          style={{ filter: flashing ? "brightness(1.35)" : undefined }}
        >
          {STROKES.map((s, i) => (
            <path
              key={s.key}
              ref={(el) => {
                strokeRefs.current[i] = el;
              }}
              d={s.d}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1}
              style={{ visibility: "hidden" }}
            />
          ))}
        </g>
      </svg>

      {/* Knock flash washes over the whole doorway. */}
      {flashing && (
        <div className="pointer-events-none absolute inset-0 z-20 bg-white/10" />
      )}
    </div>
  );
}
