/**
 * Regression (mejirodai): geolocate used to build the search hint from the
 * raw identified name alone, silently discarding identifyTarget's LLM-crafted
 * Japanese query — a romanized "mejirodai dental clinic" went to ja-JP
 * SearXNG verbatim and buried the official 目白台歯科 under booking sites.
 */
import { describe, expect, it } from "vitest";
import { run } from "./steps/geolocate.mjs";

describe("geolocate.run", () => {
  it("prefers the crafted query over the raw name", async () => {
    const out = await run({
      name: "目白台歯科医院",
      city: "文京区",
      query: "目白台歯科医院 文京区 予約",
    });
    // City not duplicated when the crafted query already contains it.
    expect(out.queryHint).toBe("目白台歯科医院 文京区 予約");
    expect(out.locality).toBe("文京区");
  });

  it("appends the city when the query lacks it", async () => {
    const out = await run({ name: "目白台歯科医院", city: "文京区", query: "目白台歯科医院 予約" });
    expect(out.queryHint).toBe("目白台歯科医院 予約 文京区");
  });

  it("falls back to the name when no query was crafted", async () => {
    const out = await run({ name: "目白台歯科医院", city: "文京区" });
    expect(out.queryHint).toBe("目白台歯科医院 文京区");
  });

  it("returns a null hint when nothing is known", async () => {
    const out = await run({});
    expect(out.queryHint).toBeNull();
    expect(out.locality).toBeNull();
  });

  it("tolerates non-string junk like the graph's optional ctx fields", async () => {
    const out = await run({ name: undefined, city: null, query: 42 });
    expect(out.queryHint).toBeNull();
  });
});
