import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VOICE_PRESET,
  VOICE_PRESETS,
  buildSimulationContext,
  generateSimulation,
} from "./sim-engine";
import {
  DOC_SUMMARY_FIXTURE,
  SIM_FIXTURE,
  SIM_JSON,
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

describe("VOICE_PRESETS", () => {
  it("exposes formal, standard and friendly presets with guidance", () => {
    expect(Object.keys(VOICE_PRESETS).sort()).toEqual(["formal", "friendly", "standard"]);
    for (const preset of Object.values(VOICE_PRESETS)) {
      expect(preset.label).toBeTruthy();
      expect(preset.guidance).toContain("【雰囲気】");
    }
  });

  it("defaults to the standard register", () => {
    expect(DEFAULT_VOICE_PRESET).toBe("standard");
  });
});

describe("buildSimulationContext", () => {
  it("renders the doc summary and the grounding answers", () => {
    const text = buildSimulationContext(DOC_SUMMARY_FIXTURE, ANSWERS);
    expect(text).toContain(DOC_SUMMARY_FIXTURE.documentType);
    expect(text).toContain(DOC_SUMMARY_FIXTURE.issuingAgency);
    expect(text).toContain(DOC_SUMMARY_FIXTURE.keyFields[0]);
    expect(text).toContain("I want to claim a medical expense tax deduction");
  });

  it("handles empty answers and special characters in Japanese text", () => {
    const doc = { ...DOC_SUMMARY_FIXTURE, documentType: "「特別支援費〜受給者証」" };
    const text = buildSimulationContext(doc, []);
    expect(text).toContain("「特別支援費〜受給者証」");
    expect(text).toContain("【電話の目的（利用者の回答）】");
    expect(text).not.toContain("q1:");
  });
});

describe("generateSimulation", () => {
  it("generates a valid, contract-compliant simulation from doc + answers", async () => {
    const fetchMock = stubFetchJson({ choices: [{ message: { content: SIM_JSON } }] });

    const result = await generateSimulation(DOC_SUMMARY_FIXTURE, ANSWERS, {
      config: TEST_CONFIG,
      preset: "standard",
    });

    expect(result).toEqual(SIM_FIXTURE);
    expect(result.script.turns.length).toBeGreaterThanOrEqual(6);
    expect(result.script.turns.length).toBeLessThanOrEqual(10);
    expect(result.script.turns[0].speaker).toBe("bureaucrat");

    const ids = new Set(result.glossary.map((g) => g.id));
    for (const turn of result.script.turns) {
      for (const id of turn.vocab) {
        expect(ids.has(id)).toBe(true);
      }
    }

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/llm");
    const body = JSON.parse(String(init.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    const userText = body.messages[1].content as string;
    expect(userText).toContain(DOC_SUMMARY_FIXTURE.documentType);
    expect(userText).toContain(DOC_SUMMARY_FIXTURE.keyFields[0]);
  });

  it("throws a typed error on malformed sim JSON", async () => {
    stubFetchJson({ choices: [{ message: { content: '{"scenarioTitle":"x"}' } }] });
    await expect(
      generateSimulation(DOC_SUMMARY_FIXTURE, ANSWERS, { config: TEST_CONFIG }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("uses the formal preset guidance in the request's system prompt", async () => {
    const fetchMock = stubFetchJson({ choices: [{ message: { content: SIM_JSON } }] });
    await generateSimulation(DOC_SUMMARY_FIXTURE, ANSWERS, {
      config: TEST_CONFIG,
      preset: "formal",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages[0].content).toContain(VOICE_PRESETS.formal.guidance);
    expect(body.messages[0].content).not.toContain(VOICE_PRESETS.friendly.guidance);
  });

  it("uses the friendly preset guidance in the request's system prompt", async () => {
    const fetchMock = stubFetchJson({ choices: [{ message: { content: SIM_JSON } }] });
    await generateSimulation(DOC_SUMMARY_FIXTURE, ANSWERS, {
      config: TEST_CONFIG,
      preset: "friendly",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages[0].content).toContain(VOICE_PRESETS.friendly.guidance);
    expect(body.messages[0].content).not.toContain(VOICE_PRESETS.formal.guidance);
  });
});
