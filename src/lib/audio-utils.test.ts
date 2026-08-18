import { describe, expect, it } from "vitest";
import { encodeWavPcm16, resampleMono } from "./audio-utils";

describe("resampleMono", () => {
  it("returns the input unchanged for the same rate", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleMono(input, 16000, 16000)).toBe(input);
  });

  it("downsamples 48kHz to 16kHz by a factor of 3", () => {
    const input = new Float32Array(4800);
    for (let i = 0; i < input.length; i++) input[i] = i / 100;
    const out = resampleMono(input, 48000, 16000);
    expect(out.length).toBe(1600);
    // The first sample survives; the last output maps onto a nearby input sample.
    expect(out[0]).toBeCloseTo(input[0], 5);
    expect(Math.abs(out[out.length - 1] - input[input.length - 1])).toBeLessThan(3);
  });

  it("keeps the same duration across rate changes", () => {
    const input = new Float32Array(48000).fill(0.5);
    const out = resampleMono(input, 48000, 16000);
    expect(out.length / 16000).toBeCloseTo(input.length / 48000, 5);
  });
});

describe("encodeWavPcm16", () => {
  it("writes a valid 16kHz mono PCM WAV header", () => {
    const samples = new Float32Array(16000);
    const buffer = encodeWavPcm16(samples);
    const view = new DataView(buffer);

    expect(buffer.byteLength).toBe(44 + 16000 * 2);
    expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 16000 * 2);
    expect(String.fromCharCode(...new Uint8Array(buffer, 8, 4))).toBe("WAVE");
    expect(String.fromCharCode(...new Uint8Array(buffer, 12, 4))).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint32(28, true)).toBe(32000); // byte rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(String.fromCharCode(...new Uint8Array(buffer, 36, 4))).toBe("data");
    expect(view.getUint32(40, true)).toBe(16000 * 2);
  });

  it("clamps to [-1, 1] and scales to 16-bit", () => {
    const samples = new Float32Array([0, 0.5, 1, -1, -0.5, 2]);
    const view = new DataView(encodeWavPcm16(samples));
    const read = (i: number) => view.getInt16(44 + i * 2, true);
    expect(read(0)).toBe(0);
    expect(read(1)).toBe(Math.round(0.5 * 0x7fff));
    expect(read(2)).toBe(0x7fff);
    expect(read(3)).toBe(-0x8000);
    expect(read(4)).toBe(Math.round(-0.5 * 0x8000));
    expect(read(5)).toBe(0x7fff); // clamped
  });
});
