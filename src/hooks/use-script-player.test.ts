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
  const present = vi.fn(async () => ({
    success: true,
    code: "0" as PresentationResult["code"],
  }));
  const deps: ScriptPlayerDeps = {
    present,
    resumeAudio: vi.fn(async () => {}),
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

  it("interrupt halts playback and resets to idle", async () => {
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
});
