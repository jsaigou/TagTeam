import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
// @ts-expect-error server .mjs modules ship without type declarations
import { attachHub, createUploadStore, generatePairingCode, PAIRING_TTL_MS } from "../../server/hub.mjs";
// @ts-expect-error server .mjs modules ship without type declarations
import * as schema from "../../server/schema.mjs";

/* Real in-memory SQLite DB so pairing resolution exercises drizzle end-to-end
   (including timestamp_ms conversion of pairing_expires_at). */
function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    CREATE TABLE "app_session" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "status" text NOT NULL DEFAULT 'active',
      "pairing_token" text,
      "pairing_expires_at" integer,
      "created_at" integer NOT NULL
    );
    CREATE INDEX "app_session_user_idx" ON "app_session" ("user_id");
  `);
  return drizzle(sqlite, { schema });
}

function activeSessionRow() {
  return {
    id: "session-1",
    userId: "user-1",
    status: "active",
    pairingToken: "K3M9QX",
    pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS),
    createdAt: new Date(),
  };
}

const servers: http.Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** Start a hub backed by an in-memory DB pre-seeded with the given rows. */
async function startHub(
  rows: object[] = [],
  orchestrator?: unknown,
  hubOptions: Record<string, unknown> = {},
) {
  const db = makeDb();
  for (const row of rows) {
    await db.insert(schema.appSession).values(row as never).run();
  }
  const server = http.createServer();
  const hub = attachHub(server, { db, schema, orchestrator, ...hubOptions });
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { hub, url: `ws://127.0.0.1:${port}/api/ws` };
}

type TestClient = {
  ws: WebSocket;
  received: unknown[];
  opened: Promise<void>;
};

function connect(url: string, join: unknown): TestClient {
  const ws = new WebSocket(url);
  sockets.push(ws);
  const received: unknown[] = [];
  ws.on("message", (data: Buffer) => received.push(JSON.parse(data.toString())));
  const opened = new Promise<void>((resolve) => ws.on("open", () => resolve()));
  ws.on("open", () => ws.send(JSON.stringify(join)));
  return { ws, received, opened };
}

const joinStage = { type: "join", pairingToken: "K3M9QX", capabilities: ["stage", "input", "control"] };
const joinPhone = { type: "join", pairingToken: "K3M9QX", capabilities: ["input", "control"] };

type HubTestMessage = { type?: string } & Record<string, unknown>;

function waitFor<T extends HubTestMessage = HubTestMessage>(
  client: TestClient,
  predicate: (m: T) => boolean,
  ms = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const check = () => {
      const hit = client.received.find(predicate as (m: unknown) => boolean) as T | undefined;
      if (hit) return resolve(hit);
      if (Date.now() > deadline) return reject(new Error("timed out waiting for message"));
      setTimeout(check, 10);
    };
    check();
  });
}

describe("generatePairingCode", () => {
  it("produces 6 chars from the unambiguous alphabet", () => {
    for (let i = 0; i < 20; i++) {
      const code = generatePairingCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });
});

describe("createUploadStore", () => {
  it("stores, returns, removes and expires uploads", () => {
    const store = createUploadStore({ ttlMs: 1000, maxBytes: 1024, maxUploads: 2 });
    const result = store.create({
      filename: "page.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("abc"),
      sessionId: "s1",
    });
    expect(result.uploadId).toBeTruthy();
    expect(store.get(result.uploadId)?.filename).toBe("page.jpg");
    expect(store.remove(result.uploadId)).toBe(true);
    expect(store.get(result.uploadId)).toBeNull();
  });

  it("rejects oversized uploads", () => {
    const store = createUploadStore({ maxBytes: 4 });
    expect(() =>
      store.create({ filename: "big", mimeType: "image/jpeg", buffer: Buffer.alloc(5), sessionId: "s" }),
    ).toThrow(/8 MB|limit/i);
  });

  it("rejects when full until swept", () => {
    const store = createUploadStore({ maxBytes: 1024, maxUploads: 1 });
    store.create({ filename: "a", mimeType: "image/jpeg", buffer: Buffer.alloc(1), sessionId: "s" });
    expect(() =>
      store.create({ filename: "b", mimeType: "image/jpeg", buffer: Buffer.alloc(1), sessionId: "s" }),
    ).toThrow(/pending uploads/i);
  });
});

describe("session hub", () => {
  it("joins a stage device and broadcasts the device list", async () => {
    const { url } = await startHub([activeSessionRow()]);
    const stage = connect(url, joinStage);
    await stage.opened;
    const joined = await waitFor(stage, (m) => m?.type === "joined");
    expect(joined).toMatchObject({ roles: ["stage", "input", "control"] });
    const devices = await waitFor(stage, (m) => m?.type === "devices");
    const deviceList = devices.devices as unknown[];
    expect(deviceList).toHaveLength(1);
    expect(deviceList[0]).toMatchObject({ connected: true, capabilities: ["stage", "input", "control"] });
  });

  it("downgrades a second stage join to control-only", async () => {
    const { url } = await startHub([activeSessionRow()]);
    const first = connect(url, joinStage);
    const second = connect(url, joinStage);
    await Promise.all([first.opened, second.opened]);
    const secondJoined = await waitFor(second, (m) => m?.type === "joined");
    expect(secondJoined.roles).toEqual(["input", "control"]);
  });

  it("rejects an invalid pairing code", async () => {
    const { url } = await startHub([activeSessionRow()]);
    const client = connect(url, { type: "join", pairingToken: "NOPE99", capabilities: ["stage"] });
    const error = await waitFor(client, (m) => m?.type === "error");
    expect(error.code).toBe("INVALID_PAIRING");
  });

  it("rejects an expired pairing code", async () => {
    const { url } = await startHub([
      { ...activeSessionRow(), pairingExpiresAt: new Date(Date.now() - 1000) },
    ]);
    const client = connect(url, joinPhone);
    const error = await waitFor(client, (m) => m?.type === "error");
    expect(error.code).toBe("INVALID_PAIRING");
  });

  it("routes companion control to the stage device", async () => {
    const { url } = await startHub([activeSessionRow()]);
    const stage = connect(url, joinStage);
    const phone = connect(url, joinPhone);
    await Promise.all([stage.opened, phone.opened]);
    await waitFor(stage, (m) => m?.type === "joined");
    await waitFor(phone, (m) => m?.type === "joined");
    phone.ws.send(JSON.stringify({ type: "control", action: "hold" }));
    const control = await waitFor(stage, (m) => m?.type === "control");
    expect(control).toMatchObject({ action: "hold" });
  });

  it("broadcasts stage state and hands the latest to late joiners", async () => {
    const { url } = await startHub([activeSessionRow()]);
    const stage = connect(url, joinStage);
    const phone = connect(url, joinPhone);
    await Promise.all([stage.opened, phone.opened]);
    await waitFor(stage, (m) => m?.type === "joined");
    await waitFor(phone, (m) => m?.type === "joined");
    stage.ws.send(
      JSON.stringify({
        type: "state",
        snapshot: { sessionId: "session-1", status: "running", screen: "call" },
      }),
    );
    const state = await waitFor(phone, (m) => m?.type === "state");
    expect(state.snapshot).toMatchObject({ status: "running" });

    const late = connect(url, joinPhone);
    const joined = await waitFor(late, (m) => m?.type === "joined");
    expect(joined.snapshot).toMatchObject({ status: "running" });
  });

  it("relays companion uploads to the stage and deletes on ack", async () => {
    const { hub, url } = await startHub([activeSessionRow()]);
    const stage = connect(url, joinStage);
    const phone = connect(url, joinPhone);
    await Promise.all([stage.opened, phone.opened]);
    // Wait for both joins to be processed server-side before sending.
    await waitFor(stage, (m) => m?.type === "joined");
    await waitFor(phone, (m) => m?.type === "joined");

    const upload = hub.uploadStore.create({
      filename: "page-1.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("photo"),
      sessionId: "session-1",
    });
    phone.ws.send(
      JSON.stringify({ type: "upload", uploadId: upload.uploadId, filename: upload.filename }),
    );
    const relay = await waitFor(stage, (m) => m?.type === "upload");
    expect(relay).toMatchObject({ uploadId: upload.uploadId, filename: "page-1.jpg" });
    expect(hub.uploadStore.get(upload.uploadId)).toBeTruthy();

    stage.ws.send(JSON.stringify({ type: "ack", uploadId: upload.uploadId }));
    const ack = await waitFor(phone, (m) => m?.type === "ack");
    expect(ack.uploadId).toBe(upload.uploadId);
    expect(hub.uploadStore.get(upload.uploadId)).toBeNull();
  });

  it("errors on messages before joining", async () => {
    const { url } = await startHub([activeSessionRow()]);
    const ws = new WebSocket(url);
    sockets.push(ws);
    const received: unknown[] = [];
    ws.on("message", (data: Buffer) => received.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send(JSON.stringify({ type: "control", action: "hold" }));
    const error = await new Promise<{ code?: string }>((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const check = () => {
        const hit = received.find((m) => (m as HubTestMessage)?.type === "error");
        if (hit) return resolve(hit as { code?: string });
        if (Date.now() > deadline) return reject(new Error("timed out"));
        setTimeout(check, 10);
      };
      check();
    });
    expect(error.code).toBe("NOT_JOINED");
  });

  it("runs audio through the orchestrator and broadcasts phase + turns", async () => {
    const fakeOrchestrator = {
      handleAudio: vi.fn(async () => ({
        userTurn: { id: "u1", speaker: "user", jp: "すみません。", vocab: [] },
        replyTurn: { id: "r1", speaker: "bureaucrat", jp: "はい、承知しました。", vocab: [] },
        end: false,
      })),
      clear: vi.fn(),
    };
    const { hub, url } = await startHub([activeSessionRow()], fakeOrchestrator);
    const phone = connect(url, joinPhone);
    await phone.opened;
    await waitFor(phone, (m) => m?.type === "joined");

    const audio = hub.uploadStore.create({
      filename: "audio-1.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("wavdata"),
      sessionId: "session-1",
    });
    phone.ws.send(JSON.stringify({ type: "audio", audioId: audio.uploadId, mimeType: "audio/wav" }));

    const thinking = await waitFor(phone, (m) => m?.type === "phase" && m.phase === "thinking");
    expect(thinking.phase).toBe("thinking");
    const userTurn = await waitFor(
      phone,
      (m) => m?.type === "turn" && (m.turn as { speaker?: string })?.speaker === "user",
    );
    expect(userTurn.turn).toMatchObject({ jp: "すみません。" });
    const reply = await waitFor(
      phone,
      (m) => m?.type === "turn" && (m.turn as { speaker?: string })?.speaker === "bureaucrat",
    );
    expect(reply.turn).toMatchObject({ jp: "はい、承知しました。" });
    const idle = await waitFor(phone, (m) => m?.type === "phase" && m.phase === "idle");
    expect(idle.phase).toBe("idle");

    expect(fakeOrchestrator.handleAudio).toHaveBeenCalledWith("session-1", expect.objectContaining({ buffer: expect.any(Buffer) }));
    expect(hub.uploadStore.get(audio.uploadId)).toBeNull();
  });

  it("errors when the audio record is missing", async () => {
    const { url } = await startHub([activeSessionRow()], {
      handleAudio: vi.fn(),
      clear: vi.fn(),
    });
    const phone = connect(url, joinPhone);
    await phone.opened;
    await waitFor(phone, (m) => m?.type === "joined");
    phone.ws.send(JSON.stringify({ type: "audio", audioId: "nope" }));
    const error = await waitFor(phone, (m) => m?.type === "error");
    expect(error.code).toBe("AUDIO_EXPIRED");
  });
});

describe("heartbeat", () => {
  // Regression for the "every socket dies at 60s" bug: the hub pinged but
  // never registered a pong handler, so ws.isAlive was never restored and
  // every connection was terminated on the second heartbeat tick. A live
  // client (the `ws` package auto-replies to protocol-level pings with
  // pongs, same as a browser) must survive many ticks.
  it("keeps a responsive connection alive across multiple heartbeat ticks", async () => {
    const { url } = await startHub([activeSessionRow()], undefined, { heartbeatMs: 20 });
    const stage = connect(url, joinStage);
    await stage.opened;
    await waitFor(stage, (m) => m?.type === "joined");

    // Outlive several heartbeat intervals.
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(stage.ws.readyState).toBe(WebSocket.OPEN);
    // And it can still round-trip a message, proving the server side is alive too.
    stage.ws.send(JSON.stringify({ type: "ping" }));
    const pong = await waitFor(stage, (m) => m?.type === "pong");
    expect(pong.type).toBe("pong");
  });
});

describe("room-empty grace period", () => {
  it("keeps orchestrator state alive through a brief disconnect and rejoin", async () => {
    const clear = vi.fn();
    const { url } = await startHub([activeSessionRow()], { handleAudio: vi.fn(), clear }, { roomEmptyGraceMs: 200 });

    const first = connect(url, joinStage);
    await first.opened;
    await waitFor(first, (m) => m?.type === "joined");
    first.ws.close();

    // Rejoin well within the grace period.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = connect(url, joinStage);
    await second.opened;
    await waitFor(second, (m) => m?.type === "joined");

    // Give the (cancelled) cleanup timer's original deadline time to pass.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(clear).not.toHaveBeenCalled();
  });

  it("still tears down the room if nobody rejoins within the grace period", async () => {
    const clear = vi.fn();
    const { url } = await startHub([activeSessionRow()], { handleAudio: vi.fn(), clear }, { roomEmptyGraceMs: 30 });

    const client = connect(url, joinStage);
    await client.opened;
    await waitFor(client, (m) => m?.type === "joined");
    client.ws.close();

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(clear).toHaveBeenCalledWith("session-1");
  });
});
