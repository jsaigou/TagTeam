import { afterEach, describe, expect, it, vi } from "vitest";
import { isByoEnabled, synthesizeSpeech } from "./tts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isByoEnabled", () => {
  it("is off by default", () => {
    expect(isByoEnabled({})).toBe(false);
    expect(isByoEnabled({ VITE_TTS_PROVIDER: "" })).toBe(false);
    expect(isByoEnabled({ VITE_TTS_PROVIDER: "perxona" })).toBe(false);
  });

  it("turns on with VITE_TTS_PROVIDER=byo", () => {
    expect(isByoEnabled({ VITE_TTS_PROVIDER: "byo" })).toBe(true);
    expect(isByoEnabled({ VITE_TTS_PROVIDER: "BYO" })).toBe(true);
  });
});

describe("synthesizeSpeech", () => {
  it("POSTs the text and resolves the WAV bytes", async () => {
    const wav = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]);
    const mock = vi.fn(async () =>
      new Response(wav, {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      }),
    );
    vi.stubGlobal("fetch", mock);

    const bytes = await synthesizeSpeech("こんにちは");

    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tts");
    expect(JSON.parse(String(init.body))).toEqual({ text: "こんにちは" });
    expect(new Uint8Array(bytes)).toEqual(wav);
  });

  it("throws the server error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "TTS is not configured" }), {
            status: 501,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(synthesizeSpeech("x")).rejects.toThrow("TTS is not configured");
  });
});
