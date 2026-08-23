import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  computeIntro,
  INTRO_END,
  REVEAL_START,
  type IntroFrame,
} from "./intro-timeline";
import {
  AVATAR_WINDOW_RIGHT,
  AVATAR_WINDOW_SIZE,
  AVATAR_WINDOW_TOP,
} from "@/lib/avatar-window";
import { playKnock } from "@/lib/sfx";

/** Line-art ink: pure brand color while drawing, warming into a dark walnut
 *  groove as the material transition completes. */
const ink = (texture: number): string =>
  `color-mix(in srgb, var(--primary) ${Math.round((1 - texture) * 100)}%, #2b1a10)`;

const WALNUT = "linear-gradient(168deg, #6e4a30 0%, #593a2a 55%, #452b21 100%)";
const BRASS = "radial-gradient(circle at 35% 30%, #e6c37a 0%, #c89b4a 45%, #8a6a2f 100%)";

/** Bevel lighting: shadow along the hinge side, highlight catching light on
 *  the leading (split) edge — mirrored per leaf. */
const bevelShadow = (left: boolean): string =>
  left
    ? "inset 5px 0 9px rgba(0,0,0,.5), inset -4px 0 7px rgba(255,255,255,.16), inset 0 3px 5px rgba(255,255,255,.08), inset 0 -4px 7px rgba(0,0,0,.4)"
    : "inset -5px 0 9px rgba(0,0,0,.5), inset 4px 0 7px rgba(255,255,255,.16), inset 0 3px 5px rgba(255,255,255,.08), inset 0 -4px 7px rgba(0,0,0,.4)";

const strokeAttrs = {
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  /** The leaf SVGs stretch non-uniformly to the doorway box; keep the ink at
   *  a constant pixel width regardless. */
  vectorEffect: "non-scaling-stroke",
  pathLength: 1,
  strokeDasharray: 1,
} as const;

const inkStyle = (texture: number): CSSProperties => ({
  stroke: ink(texture),
});

/** One door leaf: a hinged div that draws itself in as line art (outer edges
 *  first, then the center-split seam), settles into walnut + brass with 3D
 *  bevels, then swings open around its outer edge. */
function Leaf({
  side,
  deg,
  drawOuter,
  drawSplit,
  texture,
  flashing,
}: {
  side: "left" | "right";
  deg: number;
  drawOuter: number;
  drawSplit: number;
  texture: number;
  flashing: boolean;
}) {
  const left = side === "left";
  return (
    <div
      className="absolute top-0 h-full w-1/2 will-change-transform"
      style={{
        left: left ? 0 : "50%",
        transformOrigin: left ? "left center" : "right center",
        transform: `perspective(1100px) rotateY(${(left ? -1 : 1) * deg}deg)`,
        backfaceVisibility: "hidden",
      }}
    >
      {/* Walnut material, fading in over the flat line art. */}
      <div
        className="absolute inset-0"
        style={{
          background: WALNUT,
          opacity: texture,
          filter: flashing ? "brightness(1.35)" : undefined,
          transition: "filter 90ms ease-out",
        }}
      />
      {/* 3D bevel edges. */}
      <div
        className="absolute inset-0"
        style={{ opacity: texture, boxShadow: bevelShadow(left) }}
      />
      {/* Brass knob plate beside the split… */}
      <div
        className="absolute rounded-full"
        style={{
          opacity: texture,
          [left ? "right" : "left"]: "8%",
          top: "46%",
          width: "11%",
          aspectRatio: "1",
          background: BRASS,
          boxShadow:
            "0 1px 3px rgba(0,0,0,.55), inset 0 1px 1px rgba(255,255,255,.5)",
        }}
      />
      {/* …and brass hinges on the frame edge. */}
      {[0.14, 0.68].map((y) => (
        <div
          key={y}
          className="absolute"
          style={{
            opacity: texture,
            [left ? "left" : "right"]: "3.5%",
            top: `${y * 100}%`,
            width: "4.5%",
            height: "10%",
            borderRadius: 2,
            background: BRASS,
            boxShadow: "inset 0 1px 1px rgba(255,255,255,.4)",
          }}
        />
      ))}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 260"
        preserveAspectRatio="none"
      >
        <g {...strokeAttrs} style={inkStyle(texture)}>
          {/* Outer edges: hinge side, top, bottom. */}
          <path d={left ? "M2 2 L2 258" : "M98 2 L98 258"} strokeDashoffset={Math.max(0, 1 - drawOuter)} />
          <path d="M2 2 L98 2" strokeDashoffset={Math.max(0, 1 - drawOuter)} />
          <path d="M2 258 L98 258" strokeDashoffset={Math.max(0, 1 - drawOuter)} />
          {/* Routed panel moldings ride the outer pass. */}
          <rect x={left ? 14 : 16} y="26" width="70" height="88" rx="3" strokeDashoffset={Math.max(0, 1 - drawOuter)} />
          <rect x={left ? 14 : 16} y="132" width="70" height="98" rx="3" strokeDashoffset={Math.max(0, 1 - drawOuter)} />
          {/* Center split — the seam that parts from its sibling, drawn last. */}
          <path d={left ? "M98 2 L98 258" : "M2 2 L2 258"} strokeDashoffset={Math.max(0, 1 - drawSplit)} />
        </g>
      </svg>
    </div>
  );
}

/** The Get Started reveal: a double door draws itself over Luna's corner
 *  window (exactly the avatar-window rect — the stage sits behind it),
 *  solidifies into walnut + brass, gets knocked, swings open onto Luna waving,
 *  then fades away. Only then does SetupScreen start her greeting. Tapping or
 *  pressing Enter/Space on the door skips straight to the end; the rest of
 *  the screen stays live underneath. */
export function DoorsIntro({
  onFinish,
  onReveal,
}: {
  /** Sequence finished (`skip` = user dismissed it early). */
  onFinish: (skip: boolean) => void;
  /** Doors are open — wave silently (fires once per run). */
  onReveal: () => void;
}) {
  const [frame, setFrame] = useState<IntroFrame>(() => computeIntro(0));
  const [flashing, setFlashing] = useState(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const knocksRef = useRef(0);
  const revealedRef = useRef(false);
  const doneRef = useRef(false);
  const flashTimerRef = useRef(0);

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
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const t = now - startRef.current;
      const next = computeIntro(t);
      setFrame(next);
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
      role="button"
      tabIndex={0}
      aria-label="Luna's door is opening — tap to skip"
      className="fixed z-50 cursor-pointer select-none overflow-hidden rounded-2xl outline-none"
      style={{
        top: AVATAR_WINDOW_TOP,
        right: AVATAR_WINDOW_RIGHT,
        width: AVATAR_WINDOW_SIZE,
        height: AVATAR_WINDOW_SIZE,
        opacity: frame.opacity,
        boxShadow: "0 12px 32px rgba(0,0,0,.35)",
      }}
      onPointerDown={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") finish(true);
      }}
    >
      {/* Dark jamb behind the leaves — hides the stage until the doors part. */}
      <div className="absolute inset-0 bg-[#171009]" style={{ opacity: frame.jamb }} />

      <Leaf
        side="left"
        deg={frame.doorDeg}
        drawOuter={frame.drawOuter}
        drawSplit={frame.drawSplit}
        texture={frame.texture}
        flashing={flashing}
      />
      <Leaf
        side="right"
        deg={frame.doorDeg}
        drawOuter={frame.drawOuter}
        drawSplit={frame.drawSplit}
        texture={frame.texture}
        flashing={flashing}
      />

      {/* Casing line art over the hole; it never rotates. */}
      <svg
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        viewBox="0 0 200 260"
        preserveAspectRatio="none"
      >
        <g
          {...strokeAttrs}
          style={{ ...inkStyle(frame.texture), strokeWidth: 5 }}
          strokeDashoffset={Math.max(0, 1 - frame.drawOuter)}
        >
          <rect x="3" y="3" width="194" height="254" />
        </g>
      </svg>
    </div>
  );
}
