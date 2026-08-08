import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCheatSheetContext, generateCheatSheet } from "./cheat-sheet";
import {
  CHEAT_SHEET_FIXTURE,
  CHEAT_SHEET_JSON,
  SIM_FIXTURE,
} from "../fixtures/llm";
import type { GroundingAnswer } from "../shared/contract";

const TEST_CONFIG = {
  baseUrl: "https://example.test/v1",
  apiKey: "sk-test",
  model: "test-model",
};

const ANSWERS: GroundingAnswer[] = [
  { questionId: "q1", answer: "I want to claim a medical expense tax deduction" },
  { questionId: "q2", answer: "I don't know the filing deadline" },
];

function stubFetchJson(payload: unknown, status = 200) {
  const mock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildCheatSheetContext", () => {
  it("renders turns, glossary and answers, preserving Japanese text", () => {
    const text = buildCheatSheetContext({
      script: SIM_FIXTURE.script,
      glossary: SIM_FIXTURE.glossary,
      answers: ANSWERS,
    });
    expect(text).toContain("お電話ありがとうございます");
    expect(text).toContain("医療費のお知らせ");
    expect(text).toContain("bureaucrat:");
    expect(text).toContain("g1 医療費のお知らせ（いりょうひのおしらせ）");
    expect(text).toContain("q1: I want to claim a medical expense tax deduction");
  });

  it("handles empty inputs", () => {
    const text = buildCheatSheetContext({
      script: { scenarioTitle: "", turns: [] },
      glossary: [],
      answers: [],
    });
    expect(text).toContain("【電話の台本】");
    expect(text).toContain("【利用者の目的（回答）】");
    expect(text).toBeTruthy();
  });
});

describe("generateCheatSheet", () => {
  it("builds a valid cheat sheet from script + glossary + answers", async () => {
    const fetchMock = stubFetchJson({ choices: [{ message: { content: CHEAT_SHEET_JSON } }] });

    const sheet = await generateCheatSheet(
      {
        script: SIM_FIXTURE.script,
        glossary: SIM_FIXTURE.glossary,
        answers: ANSWERS,
      },
      { config: TEST_CONFIG },
    );

    expect(sheet).toEqual(CHEAT_SHEET_FIXTURE);
    expect(sheet.keyPhrases.length).toBeGreaterThanOrEqual(3);
    expect(sheet.practice.length).toBeGreaterThanOrEqual(3);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    const userText = body.messages[1].content as string;
    expect(userText).toContain("お電話ありがとうございます");
    expect(userText).toContain("医療費控除");
  });

  it("throws a typed error when the cheat sheet shape is wrong", async () => {
    stubFetchJson({ choices: [{ message: { content: '{"goal":"just a goal"}' } }] });
    await expect(
      generateCheatSheet(
        {
          script: SIM_FIXTURE.script,
          glossary: SIM_FIXTURE.glossary,
          answers: ANSWERS,
        },
        { config: TEST_CONFIG },
      ),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
});
