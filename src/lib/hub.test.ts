import { beforeEach, describe, expect, it, vi } from "vitest";
import { HubClient, type HubMessageListener, type HubSocket } from "./hub";
import type { WsServerMessage } from "@/shared/contract";

/** Minimal fake WebSocket for testing HubClient without a browser/network. */
class FakeWebSocket implements HubSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  url: string;
  sent: string[] = [];
  handlers: Map<string, Set<(event: unknown) => void>>;

  constructor(url: string) {
    this.url = url;
    this.handlers = new Map();
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (event: unknown) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit("close", {});
  }

  emit(type: string, event: unknown) {
    this.handlers.get(type)?.forEach((fn) => fn(event));
  }

  /* test helpers */
  open() {
    this.readyState = 1;
    this.emit("open", {});
  }

  receive(message: WsServerMessage) {
    this.emit("message", { data: JSON.stringify(message) });
  }
}

function makeClient(): HubClient {
  const client = new HubClient("ws://test/api/ws", (url) => new FakeWebSocket(url));
  return client;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
});

describe("HubClient", () => {
  it("connects, sends the join message, and reports status open", () => {
    const client = makeClient();
    const statuses: string[] = [];
    client.onStatusChange = (s) => statuses.push(s);
    client.connect({ type: "join", pairingToken: "ABC123", capabilities: ["stage"] });
    const ws = FakeWebSocket.instances.at(-1)!;
    expect(client.status).toBe("connecting");
    ws.open();
    expect(client.status).toBe("open");
    expect(client.connected).toBe(true);
    expect(ws.sent[0]).toBe(
      JSON.stringify({ type: "join", pairingToken: "ABC123", capabilities: ["stage"] }),
    );
    client.close();
  });

  it("delivers parsed server messages to subscribers", () => {
    const client = makeClient();
    const received: WsServerMessage[] = [];
    const unsub = client.subscribe((msg) => received.push(msg));
    client.connect({ type: "join", pairingToken: "ABC123", capabilities: [] });
    FakeWebSocket.instances.at(-1)!.open();
    FakeWebSocket.instances.at(-1)!.receive({
      type: "joined",
      deviceId: "d1",
      roles: ["stage"],
      snapshot: null,
    });
    FakeWebSocket.instances.at(-1)!.receive({ type: "devices", devices: [] });
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ type: "joined", deviceId: "d1" });
    unsub();
    FakeWebSocket.instances.at(-1)!.receive({ type: "devices", devices: [] });
    expect(received).toHaveLength(2);
    client.close();
  });

  it("drops non-JSON messages", () => {
    const client = makeClient();
    const received: WsServerMessage[] = [];
    const listener: HubMessageListener = (msg) => received.push(msg);
    client.subscribe(listener);
    client.connect({ type: "join", pairingToken: "ABC123", capabilities: [] });
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.handlers.get("message")!.forEach((fn) => fn({ data: "not json" }));
    expect(received).toHaveLength(0);
    client.close();  });

  it("reconnects with backoff after an unexpected close", () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      client.connect({ type: "join", pairingToken: "ABC123", capabilities: [] });
      const first = FakeWebSocket.instances.at(-1)!;
      first.open();
      const statuses: string[] = [];
      client.onStatusChange = (s) => statuses.push(s);
      first.close();
      expect(client.status).toBe("closed");
      expect(client.connected).toBe(false);
      vi.advanceTimersByTime(501);
      const second = FakeWebSocket.instances.at(-1)!;
      expect(second).not.toBe(first);
      expect(client.status).toBe("connecting");
      second.open();
      expect(client.status).toBe("open");
      expect(second.sent[0]).toContain("pairingToken");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reconnect after a user-initiated close", () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      client.connect({ type: "join", pairingToken: "ABC123", capabilities: [] });
      const ws = FakeWebSocket.instances.at(-1)!;
      ws.open();
      client.close();
      vi.advanceTimersByTime(5000);
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(client.status).toBe("closed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send until open", () => {
    const client = makeClient();
    client.connect({ type: "join", pairingToken: "ABC123", capabilities: [] });
    const ws = FakeWebSocket.instances.at(-1)!;
    client.send({ type: "ping" });
    expect(ws.sent).toHaveLength(0);
    ws.open();
    client.send({ type: "ping" });
    expect(ws.sent).toHaveLength(2); // join + ping
    client.close();
  });
});
