import { describe, expect, it, vi } from "vitest";

import type { PresentationResult } from "@/lib/presenter";
import type { GlossaryEntry, SimScript } from "@/shared/contract";
import {
  createScriptPlayer,
  type ScriptPlayerDeps,
  type PlayerInternals,
} from "./use-script-player";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeDeps() {
  const present = vi.fn(
    async (): Promise<PresentationResult> => ({
      success: true,
      code: "0" as PresentationResult["code"],
    }),
  );
  const deps: ScriptPlayerDeps = {
    present,
    interrupt: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  };
  return { deps, present };
}

const glossary: GlossaryEntry[] = [
  { id: "zairyu", kanji: "在留", furigana: "ざいりゅう", en: "residence", note: "Status of residence" },
];

const script: SimScript = {
  scenarioTitle: "test",
  turns: [
    { id: "t1", speaker: "bureaucrat", jp: "こんにちは。", en: "Hello.", vocab: ["zairyu"], motion: "[MOTION id:1]" },
    { id: "t2", speaker: "user", jp: "よろしくお願いします。", en: "Please.", vocab: [] },
    { id: "t3", speaker: "bureaucrat", jp: "お待ちください。", en: "One moment.", vocab: [] },
  ],
};

const scriptAllBureaucrat: SimScript = {
  scenarioTitle: "test-all",
  turns: [
    { id: "t1", speaker: "bureaucrat", jp: "こんにちは。", en: "Hello.", vocab: [] },
    { id: "t2", speaker: "bureaucrat", jp: "お待ちください。", en: "One moment.", vocab: [] },
    { id: "t3", speaker: "bureaucrat", jp: "ありがとうございました。", en: "Thank you.", vocab: [] },
  ],
};

describe("createScriptPlayer", () => {
  it("paces bureaucrat turns and pauses at user turns", async () => {
    const { deps, present } = makeDeps();
    const player: PlayerInternals = createScriptPlayer(deps);
    const turns: string[] = [];
    player.setEvents({ onTurn: (turn) => turns.push(turn.id) });

    player.load(script, glossary);
    expect(player.getState()).toBe("idle");

    player.play();
    await flush();
    expect(player.getState()).toBe("talking");
    expect(turns).toEqual(["t1"]);
    expect(present).toHaveBeenCalledWith("[MOTION id:1] こんにちは。");

    // t1 finishes speaking -> advance to the user turn and wait.
    player.notifyPerformanceEnd();
    expect(turns).toEqual(["t1", "t2"]);
    expect(player.getState()).toBe("talking");

    // Nothing is spoken for the user turn; resume continues to t3.
    expect(present).toHaveBeenCalledTimes(1);
    player.resume();
    await flush();
    expect(turns).toEqual(["t1", "t2", "t3"]);
    expect(present).toHaveBeenCalledTimes(2);

    player.notifyPerformanceEnd();
    expect(player.getState()).toBe("ended");
  });

  it("halts to idle when present() reports a failed result", async () => {
    const { deps, present } = makeDeps();
    const player: PlayerInternals = createScriptPlayer(deps);

    present.mockResolvedValueOnce({
      success: false,
      code: "200" as PresentationResult["code"],
      message: "boom",
    });

    player.load(script, glossary);
    player.play();
    await flush();

    expect(player.getState()).toBe("idle");
    expect(present).toHaveBeenCalledTimes(1);

    // A late PERFORMANCE_END must not revive a halted run.
    player.notifyPerformanceEnd();
    await flush();
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("does not halt when present() returns undefined (unmounted presenter)", async () => {
    const { deps, present } = makeDeps();
    const player: PlayerInternals = createScriptPlayer(deps);

    present.mockResolvedValueOnce(undefined as unknown as PresentationResult);

    player.load(scriptAllBureaucrat, glossary);
    player.play();
    await flush();

    expect(player.getState()).toBe("talking");
    expect(present).toHaveBeenCalledTimes(1);

    player.notifyPerformanceEnd();
    await flush();
    expect(present).toHaveBeenCalledTimes(2);
  });

  it("does not halt when present() is intentionally interrupted (code 303)", async () => {
    const { deps, present } = makeDeps();
    const player: PlayerInternals = createScriptPlayer(deps);

    present.mockResolvedValueOnce({
      success: false,
      code: "303" as PresentationResult["code"],
      message: "interrupted",
    });

    player.load(scriptAllBureaucrat, glossary);
    player.play();
    await flush();

    // An interrupted dispatch is an intentional abort (resume/interrupt), not a
    // failure — the run must stay alive.
    expect(player.getState()).toBe("talking");
    expect(present).toHaveBeenCalledTimes(1);

    // A real performance end still advances to the next turn.
    player.notifyPerformanceEnd();
    await flush();
    expect(present).toHaveBeenCalledTimes(2);
  });

  it("hold pauses at the next turn boundary and speaks the breakdown", async () => {
    const { deps, present } = makeDeps();
    const player: PlayerInternals = createScriptPlayer(deps);

    player.load(script, glossary);
    player.play();
    const hold = player.hold();

    // Not at a boundary yet (t1 still speaking): still talking.
    expect(player.getState()).toBe("talking");

    player.notifyPerformanceEnd();
    const help = await hold;
    await flush();
    expect(player.getState()).toBe("held");
    expect(help.explanationJp).toContain("こんにちは");
    expect(help.explanationEn).toContain("Hello");
    // The breakdown is a normal present().
    expect(present).toHaveBeenLastCalledWith(help.explanationJp);

    player.resume();
    expect(player.getState()).toBe("talking");
  });

  it("resume during a pending hold resolves it without double-advancing", async () => {
    const { deps, present } = makeDeps();
    const player: PlayerInternals = createScriptPlayer(deps);
    const turns: string[] = [];
    player.setEvents({ onTurn: (turn) => turns.push(turn.id) });

    player.load(scriptAllBureaucrat, glossary);
    player.play();
    await flush();
    expect(present).toHaveBeenCalledTimes(1); // t1 speaking

    const hold = player.hold();
    expect(player.getState()).toBe("talking");

    // Resume before the boundary: the pending hold must resolve, not hang.
    player.resume();
    const help = await hold;
    expect(help.explanationJp).toBeTruthy();

    // The interrupted speech's PERFORMANCE_END arrives: it is the stale end and
    // must NOT advance the queue.
    player.notifyPerformanceEnd();
    await flush();
    expect(turns).toEqual(["t1", "t2"]);
    expect(present).toHaveBeenCalledTimes(2); // t1 + t2 — no double advance

    // The real end of t2 advances to t3; t3's end ends the run.
    player.notifyPerformanceEnd();
    await flush();
    expect(turns).toEqual(["t1", "t2", "t3"]);
    expect(present).toHaveBeenCalledTimes(3);

    player.notifyPerformanceEnd();
    expect(player.getState()).toBe("ended");
  });

  it("interrupt during a pending hold resolves it and resets to idle", async () => {
    const { deps } = makeDeps();
    const player = createScriptPlayer(deps);
    player.load(script, glossary);
    player.play();

    const hold = player.hold();
    player.interrupt();
    const help = await hold;
    expect(player.getState()).toBe("idle");
    expect(help.explanationJp).toBeTruthy();
  });

  it("tapHelp returns the glossary hint or null for unknown ids", () => {
    const { deps } = makeDeps();
    const player = createScriptPlayer(deps);
    player.load(script, glossary);

    expect(player.tapHelp("zairyu")).toEqual({
      entryId: "zairyu",
      hint: "Status of residence",
    });
    expect(player.tapHelp("nope")).toBeNull();
  });
});
