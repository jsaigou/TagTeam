import { useEffect } from "react";
import type { CallPhase, Turn } from "@/shared/contract";
import type { ControlListener, PhaseListener, TurnListener } from "@/state/session-context";

export type UseCallWsEventsOptions = {
  onControl: (listener: ControlListener) => () => void;
  onTurn: (listener: TurnListener) => () => void;
  onPhase: (listener: PhaseListener) => () => void;
  /** Companion phones send hold/resume/tap-help over the hub — run them here. */
  onHold: () => void;
  onResume: () => void;
  onTapHelp: (entryId: string) => void;
  /** The orchestrator broadcasts one turn at a time for the whole conversation. */
  onServerTurn: (turn: Turn, end: boolean | undefined) => void;
  /** Mirror the server's brain phase (thinking/idle) on the avatar. */
  onServerPhase: (phase: CallPhase) => void;
};

/**
 * Subscribes CallScreen to the three hub broadcasts that drive a live call:
 * companion `control` actions, orchestrator `turn`s, and brain `phase`
 * changes. Pure wiring — the actual state updates live in the callbacks the
 * caller provides, so this hook owns no state of its own.
 */
export function useCallWsEvents({
  onControl,
  onTurn,
  onPhase,
  onHold,
  onResume,
  onTapHelp,
  onServerTurn,
  onServerPhase,
}: UseCallWsEventsOptions) {
  useEffect(() => {
    return onControl((msg) => {
      if (msg.action === "hold") onHold();
      else if (msg.action === "resume") onResume();
      else if (msg.action === "tapHelp" && msg.entryId) onTapHelp(msg.entryId);
    });
  }, [onControl, onHold, onResume, onTapHelp]);

  useEffect(() => {
    return onTurn((msg) => onServerTurn(msg.turn, msg.end));
  }, [onTurn, onServerTurn]);

  useEffect(() => {
    return onPhase((msg) => onServerPhase(msg.phase));
  }, [onPhase, onServerPhase]);
}
