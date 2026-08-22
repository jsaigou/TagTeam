import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeIntro,
  DOORWAY_HEIGHT,
  DOORWAY_LIFT,
  DOORWAY_WIDTH,
  INTRO_END,
  REVEAL_START,
  type IntroFrame,
} from "./intro-timeline";
import { playKnock } from "@/lib/sfx";

const INK = "#2c2118";

const strokeProps = {
  fill: "none",
  stroke: INK,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  /** The leaf SVGs stretch non-uniformly to the doorway box; keep the ink at
   *  a constant pixel width regardless. */
  vectorEffect: "non-scaling-stroke",
  pathLength: 1,
  strokeDasharray: 1,
} as const;

/** One door leaf: a hinged div (wood fill + line art) that draws itself in,
 *  solidifies, then swings open around its outer edge. */
function Leaf({
  side,
  deg,
  draw,
  fill,
  flashing,
}: {
  side: "left" | "right";
  deg: number;
  draw: number;
  fill: number;
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
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, #8a5a33 0%, #7a4a2b 100%)",
          opacity: fill,
          filter: flashing ? "brightness(1.35)" : undefined,
          transition: "filter 90ms ease-out",
        }}
      />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 260"
        preserveAspectRatio="none"
      >
        <g {...strokeProps} strokeDashoffset={Math.max(0, 1 - draw)}>
          <path d={left ? "M2 2 L2 258" : "M98 2 L98 258"} />
          <path d="M2 2 L98 2" />
          <path d="M2 258 L98 258" />
          {/* Center split — the edge that parts from its sibling. */}
          <path d={left ? "M98 2 L98 258" : "M2 2 L2 258"} />
          <rect x={left ? 14 : 16} y="26" width="70" height="88" rx="3" />
          <rect x={left ? 14 : 16} y="132" width="70" height="98" rx="3" />
          <circle cx={left ? 89 : 11} cy="128" r="3.5" />
        </g>
      </svg>
    </div>
  );
}

/** Full-screen Get Started takeover: a double door draws itself, gets knocked,
 *  swings open onto Luna waving, then the facade fades into the setup panel.
 *  Any pointer/key input skips straight to the end. */
export function DoorsIntro({
  onFinish,
  onReveal,
}: {
  /** Sequence finished (`skip` = user dismissed it early). */
  onFinish: (skip: boolean) => void;
  /** Doors are open — wave and greet (fires once per run). */
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
      aria-label="The door is opening — tap to skip"
      className="fixed inset-0 z-50 cursor-pointer select-none outline-none"
      style={{ opacity: frame.opacity }}
      onPointerDown={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") finish(true);
      }}
    >
      {/* Facade wall with a doorway hole: the hole div's huge box-shadow paints
          the wall everywhere except the hole, which stays see-through so the
          stage behind shows once the leaves part. */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: DOORWAY_WIDTH,
          height: DOORWAY_HEIGHT,
          transform: `translate(-50%, -50%) translateY(calc(-1 * ${DOORWAY_LIFT}))`,
          boxShadow: "0 0 0 200vmax #241b15",
        }}
      >
        {/* Dark jamb behind the leaves — hides the stage until the doors part. */}
        <div className="absolute inset-0 bg-[#171009]" style={{ opacity: frame.jamb }} />

        <Leaf
          side="left"
          deg={frame.doorDeg}
          draw={frame.draw}
          fill={frame.fill}
          flashing={flashing}
        />
        <Leaf
          side="right"
          deg={frame.doorDeg}
          draw={frame.draw}
          fill={frame.fill}
          flashing={flashing}
        />

        {/* Casing line art over the hole; it never rotates. */}
        <svg
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          viewBox="0 0 200 260"
          preserveAspectRatio="none"
        >
          <g {...strokeProps} strokeWidth={6} strokeDashoffset={Math.max(0, 1 - frame.draw)}>
            <rect x="3" y="3" width="194" height="254" />
          </g>
        </svg>
      </div>
    </div>
  );
}
