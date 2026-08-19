import { describe, expect, it, vi } from "vitest";
// @ts-expect-error server .mjs modules ship without type declarations
import { buildNextTurnMessages, isNextTurnResult } from "../../server/next-turn.mjs";
// @ts-expect-error server .mjs modules ship without type declarations
import { createCallOrchestrator, NEXT_TURN_DEADLINE_MS } from "../../server/orchestrator.mjs";

const SCRIPT = {
  scenarioTitle: "Test call",
  turns: [
    { id: "t1", speaker: "bureaucrat", jp: "お電話ありがとうございます。", vocab: [] },
    { id: "t2", speaker: "user", jp: "医療費のお知らせについて。", vocab: ["g1"] },
  ],
};
const GLOSSARY = [
  { id: "g1", kanji: "医療費", furigana: "いりょうひ", en: "medical expenses" },
];

const validReply = {
  jp: "はい、承知いたしました。",
  en: "Yes, of course.",
  vocab: ["g1"],
  emotion: "caring",
  intensity: "neutral",
  done: false,
};

describe("isNextTurnResult", () => {
  it("accepts a well-formed reply", () => {
    expect(isNextTurnResult(validReply)).toBe(true);
  });

  it("rejects a reply without jp", () => {
    expect(isNextTurnResult({ ...validReply, jp: "" })).toBe(false);
    expect(isNextTurnResult({ en: "only en" })).toBe(false);
  });

  it("accepts `text` as an alias for `jp` (some local models)", () => {
    const { jp, ...rest } = validReply;
    expect(isNextTurnResult({ ...rest, text: jp })).toBe(true);
  });

  it("rejects unknown emotions / intensities", () => {
    expect(isNextTurnResult({ ...validReply, emotion: "rage" })).toBe(false);
    expect(isNextTurnResult({ ...validReply, intensity: "loud" })).toBe(false);
  });

  it("rejects non-array vocab", () => {
    expect(isNextTurnResult({ ...validReply, vocab: "g1" })).toBe(false);
  });
});

describe("buildNextTurnMessages", () => {
  it("embeds the script, glossary and running transcript", () => {
    const ctx = { script: SCRIPT, glossary: GLOSSARY, summary: "Medical notice" };
    const transcript = [{ id: "t1", speaker: "bureaucrat", jp: "お電話ありがとうございます。", vocab: [] }];
    const messages = buildNextTurnMessages(ctx, transcript);
    const joined = messages
      .map((m: { content: string }) => m.content)
      .join("\n");
    expect(joined).toContain("Medical notice");
    expect(joined).toContain("医療費");
    expect(joined).toContain("お電話ありがとうございます");
    expect(joined).toContain("g1");
  });
});

describe("createCallOrchestrator", () => {
  function makeOrchestrator(overrides: {
    stt?: ReturnType<typeof vi.fn>;
    llm?: ReturnType<typeof vi.fn>;
  } = {}) {
    const stt = vi.fn(async () => ({ text: "すみません、問い合わせたいです。" }));
    const llm = vi.fn(async () => ({
      choices: [{ message: { role: "assistant", content: JSON.stringify(validReply) } }],
    }));
    return {
      orchestrator: createCallOrchestrator({
        transcribeAudio: overrides.stt ?? stt,
        llmChat: overrides.llm ?? llm,
        config: {},
      }),
      stt,
      llm,
    };
  }

  it("seeds context and presets the first scripted bureaucrat turn", () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.setContext("s1", { script: SCRIPT, glossary: GLOSSARY });
    const transcript = orchestrator.getTranscript("s1");
    expect(transcript).toHaveLength(1);
    expect(transcript[0].speaker).toBe("bureaucrat");
  });

  it("appends user + reply turns and filters unknown vocab ids", async () => {
    const { orchestrator, stt, llm } = makeOrchestrator();
    orchestrator.setContext("s1", { script: SCRIPT, glossary: GLOSSARY });
    const { userTurn, replyTurn, end } = await orchestrator.handleAudio("s1", {
      buffer: Buffer.from("wav"),
      mimeType: "audio/wav",
    });
    expect(stt).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ mimeType: "audio/wav" }));
    expect(userTurn).toMatchObject({ speaker: "user", jp: "すみません、問い合わせたいです。" });
    expect(replyTurn).toMatchObject({
      speaker: "bureaucrat",
      jp: "はい、承知いたしました。",
      emotion: "caring",
    });
    expect(end).toBe(false);
    expect(orchestrator.getTranscript("s1")).toHaveLength(3);
    expect(llm).toHaveBeenCalledTimes(1);

    // Second call carries the accumulated transcript (brain context grows).
    await orchestrator.handleAudio("s1", { buffer: Buffer.from("wav2") });
    expect(orchestrator.getTranscript("s1")).toHaveLength(5);
  });

  it("surfaces a 422 when nothing was heard", async () => {
    const { orchestrator } = makeOrchestrator({
      stt: vi.fn(async () => ({ text: "" })),
    });
    orchestrator.setContext("s1", { script: SCRIPT, glossary: GLOSSARY });
    await expect(orchestrator.handleAudio("s1", { buffer: Buffer.from("x") })).rejects.toMatchObject({
      status: 422,
    });
  });

  it("rejects audio when no context was seeded", async () => {
    const { orchestrator } = makeOrchestrator();
    await expect(orchestrator.handleAudio("s1", { buffer: Buffer.from("x") })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("rejects concurrent audio while a turn is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { orchestrator } = makeOrchestrator({
      llm: vi.fn(async () => {
        await gate;
        return { choices: [{ message: { role: "assistant", content: JSON.stringify(validReply) } }] };
      }),
    });
    orchestrator.setContext("s1", { script: SCRIPT, glossary: GLOSSARY });
    const first = orchestrator.handleAudio("s1", { buffer: Buffer.from("x") });
    await expect(orchestrator.handleAudio("s1", { buffer: Buffer.from("y") })).rejects.toMatchObject({
      status: 409,
    });
    release();
    await first;
  });

  it("bounds the retry loop to one overall deadline instead of two full attempts", async () => {
    vi.useFakeTimers();
    // A hung llmChat that only ever settles when its signal is aborted —
    // mirrors what a real fetch does once AbortSignal.any() fires.
    const llm = vi.fn(
      (_messages: unknown, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const { orchestrator } = makeOrchestrator({ llm });
    orchestrator.setContext("s1", { script: SCRIPT, glossary: GLOSSARY });

    const promise = orchestrator.handleAudio("s1", { buffer: Buffer.from("x") });
    const assertion = expect(promise).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(NEXT_TURN_DEADLINE_MS + 1_000);
    await assertion;

    // The shared deadline fires during attempt 1 — never worth starting a
    // second full-budget attempt on top of it.
    expect(llm).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("clears session state", () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.setContext("s1", { script: SCRIPT, glossary: GLOSSARY });
    expect(orchestrator.getTranscript("s1")).toHaveLength(1);
    orchestrator.clear("s1");
    expect(orchestrator.getTranscript("s1")).toHaveLength(0);
  });
});
