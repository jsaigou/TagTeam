import { describe, expect, it } from "vitest";
import {
  deriveAppStatus,
  isPhoneJoinUrl,
  joinHashFromQr,
  parsePhoneHash,
  wsUrlFromOrigin,
} from "./session-utils";

describe("parsePhoneHash", () => {
  it("parses session id + pairing code", () => {
    expect(parsePhoneHash("#s=abc&p=K3M9QX")).toEqual({
      sessionId: "abc",
      pairingToken: "K3M9QX",
    });
  });

  it("parses a bare pairing code (manual entry)", () => {
    expect(parsePhoneHash("#p=K3M9QX")).toEqual({ pairingToken: "K3M9QX" });
  });

  it("accepts 'pair'/'session' aliases", () => {
    expect(parsePhoneHash("#session=1&pair=ABCDEF")).toEqual({
      sessionId: "1",
      pairingToken: "ABCDEF",
    });
  });

  it("returns null without a pairing code", () => {
    expect(parsePhoneHash("#s=abc")).toBeNull();
    expect(parsePhoneHash("")).toBeNull();
    expect(parsePhoneHash("#other=1")).toBeNull();
  });
});

describe("wsUrlFromOrigin", () => {
  it("swaps http(s) for ws(s) and appends the hub path", () => {
    expect(wsUrlFromOrigin("http://localhost:5173")).toBe("ws://localhost:5173/api/ws");
    expect(wsUrlFromOrigin("https://tagteam.example.ts.net")).toBe(
      "wss://tagteam.example.ts.net/api/ws",
    );
  });
});

describe("isPhoneJoinUrl", () => {
  it("matches the /phone path", () => {
    expect(isPhoneJoinUrl("/phone", "")).toBe(true);
  });
  it("matches a hash with a pairing code", () => {
    expect(isPhoneJoinUrl("/", "#s=1&p=ABCDEF")).toBe(true);
  });
  it("rejects non-phone paths without a code", () => {
    expect(isPhoneJoinUrl("/", "")).toBe(false);
    expect(isPhoneJoinUrl("/call", "#s=1")).toBe(false);
  });
});

describe("joinHashFromQr", () => {
  it("extracts the join hash from a full joinUrl (the desktop QR payload)", () => {
    expect(joinHashFromQr("https://tagteam.example.ts.net/phone#s=abc&p=K3M9QX")).toBe(
      "#s=abc&p=K3M9QX",
    );
  });
  it("passes through a bare fragment", () => {
    expect(joinHashFromQr("#p=K3M9QX")).toBe("#p=K3M9QX");
  });
  it("treats a bare 6-char code as a pairing code", () => {
    expect(joinHashFromQr("K3M9QX")).toBe("#p=K3M9QX");
    expect(joinHashFromQr("k3m9qx")).toBe("#p=K3M9QX");
  });
  it("returns null for unjoinable payloads", () => {
    expect(joinHashFromQr("")).toBeNull();
    expect(joinHashFromQr("hello world")).toBeNull();
  });
});

describe("deriveAppStatus", () => {
  it("maps call + player state", () => {
    expect(deriveAppStatus("call", "talking")).toBe("running");
    expect(deriveAppStatus("call", "held")).toBe("held");
    expect(deriveAppStatus("call", "ended")).toBe("ended");
    expect(deriveAppStatus("call", undefined)).toBe("setup");
  });
  it("maps setup/cheat-sheet", () => {
    expect(deriveAppStatus("setup", undefined)).toBe("setup");
    expect(deriveAppStatus("cheat-sheet", "ended")).toBe("ended");
  });
});
