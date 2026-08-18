/**
 * WebSocket client for the Phase 2 session hub.
 *
 * Framework-agnostic: manages the connection, JSON message send/receive, and
 * reconnect-with-backoff. The React layer (src/state/session-context.tsx) owns
 * lifecycle + role-specific handling on top of this.
 */
import type { WsClientMessage, WsServerMessage } from "@/shared/contract";

export type HubStatus = "idle" | "connecting" | "open" | "closed";

export type HubMessageListener = (message: WsServerMessage) => void;

const MAX_BACKOFF_MS = 10_000;

/** Minimal structural surface HubClient needs from a WebSocket impl. */
export interface HubSocket {
  readyState: number;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export class HubClient {
  private ws: HubSocket | null = null;
  private listeners = new Set<HubMessageListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private closedByUser = false;
  private url: string;
  private makeSocket: (url: string) => HubSocket;
  status: HubStatus = "idle";
  onStatusChange?: (status: HubStatus) => void;

  /** `makeSocket` is injectable for tests / alternate WebSocket impls. */
  constructor(url: string, makeSocket: (url: string) => HubSocket = (u) => new WebSocket(u)) {
    this.url = url;
    this.makeSocket = makeSocket;
  }

  /** Connect (or reconnect) and send `joinMessage` on every open. */
  connect(joinMessage: WsClientMessage) {
    this.closedByUser = false;
    this.clearReconnect();
    if (this.ws?.readyState === 1) return;
    this.setStatus("connecting");
    const ws = this.makeSocket(this.url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (ws !== this.ws) return;
      this.reconnectAttempt = 0;
      this.setStatus("open");
      ws.send(JSON.stringify(joinMessage));
    });

    ws.addEventListener("message", (event) => {
      let message: WsServerMessage;
      try {
        message = JSON.parse(String((event as { data?: unknown }).data));
      } catch {
        return;
      }
      for (const listener of this.listeners) listener(message);
    });

    ws.addEventListener("close", () => {
      if (ws !== this.ws) return;
      this.ws = null;
      if (this.closedByUser) {
        this.setStatus("closed");
        return;
      }
      this.scheduleReconnect(joinMessage);
    });

    ws.addEventListener("error", () => {
      /* close handler drives reconnect/status */
    });
  }

  private scheduleReconnect(joinMessage: WsClientMessage) {
    this.setStatus("closed");
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.connect(joinMessage);
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer !== null) {
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: HubStatus) {
    this.status = status;
    this.onStatusChange?.(status);
  }

  send(message: WsClientMessage) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(message));
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === 1;
  }

  subscribe(listener: HubMessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.closedByUser = true;
    this.clearReconnect();
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }
}
