import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AppSnapshot,
  ControlAction,
  DeviceCapability,
  DeviceInfo,
  ImageDoc,
  PlayerState,
  SessionSummary,
  Turn,
  WsServerMessage,
} from "@/shared/contract";
import { HubClient, type HubStatus } from "@/lib/hub";
import {
  createSession,
  fetchUploadDataUrl,
  getCurrentSession,
  rotatePairing as rotatePairingApi,
  uploadAudio,
  uploadPage,
} from "@/lib/session-api";
import {
  deriveAppStatus,
  isPhoneJoinUrl,
  parsePhoneHash,
  wsUrlFromOrigin,
} from "@/lib/session-utils";
import { useAppStore } from "./app-store";

const STAGE_CAPABILITIES: DeviceCapability[] = ["stage", "input", "control"];
const COMPANION_CAPABILITIES: DeviceCapability[] = ["input", "control"];
const MAX_PENDING_UPLOADS = 10;

export type PendingUpload = {
  uploadId: string;
  filename: string;
  dataUrl: string;
  mimeType: string;
};

export type ControlListener = (message: Extract<WsServerMessage, { type: "control" }>) => void;
export type TurnListener = (message: Extract<WsServerMessage, { type: "turn" }>) => void;
export type PhaseListener = (message: Extract<WsServerMessage, { type: "phase" }>) => void;

type SessionContextValue = {
  /** The created/reused app session (desktop). Null until ensured. */
  session: SessionSummary | null;
  hubStatus: HubStatus;
  hubError: string | null;
  devices: DeviceInfo[];
  /** Roles this device was assigned (stage is exclusive). */
  roles: DeviceCapability[];
  deviceId: string | null;
  /** Whether this device joined as the stage (runs the avatar + player). */
  isStage: boolean;
  /** Whether this tab is a phone-join URL (companion mode). */
  isPhone: boolean;
  /** Latest snapshot received from the stage (companion view). */
  snapshot: AppSnapshot | null;
  /** Pages companions pushed over the hub, waiting for the stage to add them. */
  pendingUploads: PendingUpload[];
  /** Pages this companion uploaded, still awaiting the stage's ack. */
  sentUploadIds: string[];
  /** Keep the hub's view of live player state fresh (stage). */
  setPlayerState: (state: PlayerState | undefined) => void;
  setActiveTurn: (turn: Turn | null) => void;
  /** Register a handler for `control` messages (stage receives from companions). */
  onControl: (listener: ControlListener) => () => void;
  /** Phase 3 — register a handler for orchestrator `turn` broadcasts. */
  onTurn: (listener: TurnListener) => () => void;
  /** Phase 3 — register a handler for `phase` broadcasts (thinking/idle). */
  onPhase: (listener: PhaseListener) => () => void;
  /** Stage: consume a companion-pushed page and tell the companion it's done. */
  ackPendingUpload: (uploadId: string) => void;
  /** Companion: upload a scanned page and announce it to the stage. */
  uploadFromCompanion: (page: ImageDoc) => Promise<string>;
  /** Companion: send a control action (hold / resume / tapHelp). */
  sendControl: (action: ControlAction, entryId?: string) => void;
  /** Phase 3 — upload push-to-talk audio and push it to the orchestrator. */
  sendPushToTalk: (audio: { audioBase64: string; mimeType?: string }) => Promise<void>;
  /** Desktop: rotate the pairing code (QR + manual entry). */
  rotatePairing: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function dataUrlMime(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;,]+)/);
  return match ? match[1] : "image/jpeg";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const store = useAppStore();

  /* Reactive to location.hash so a manual pairing code entered on the phone
     triggers a (re)join without a reload. */
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const isPhone = isPhoneJoinUrl(window.location.pathname, hash);
  const phoneJoin = useMemo(
    () => (isPhone ? parsePhoneHash(hash) : null),
    [isPhone, hash],
  );

  const [session, setSession] = useState<SessionSummary | null>(null);
  const [hubStatus, setHubStatus] = useState<HubStatus>("idle");
  const [hubError, setHubError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [roles, setRoles] = useState<DeviceCapability[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [sentUploadIds, setSentUploadIds] = useState<string[]>([]);

  const hubRef = useRef<HubClient | null>(null);
  const sessionRef = useRef<SessionSummary | null>(null);
  const ensurePromiseRef = useRef<Promise<SessionSummary | null> | null>(null);
  const rolesRef = useRef<DeviceCapability[]>([]);
  const controlListenersRef = useRef<Set<ControlListener>>(new Set());
  const turnListenersRef = useRef<Set<TurnListener>>(new Set());
  const phaseListenersRef = useRef<Set<PhaseListener>>(new Set());
  const playerStateRef = useRef<PlayerState | undefined>(undefined);
  const activeTurnRef = useRef<Turn | null>(null);

  const buildSnapshot = useCallback(
    (): AppSnapshot => ({
      sessionId: sessionRef.current?.id ?? "",
      status: deriveAppStatus(store.state.screen, playerStateRef.current),
      screen: store.state.screen,
      setupStep: store.state.screen === "setup" ? store.state.setupStep : undefined,
      summary: store.state.summary ?? undefined,
      scriptTitle: store.state.script?.scenarioTitle,
      playerState: store.state.screen === "call" ? playerStateRef.current : undefined,
      activeTurn: activeTurnRef.current ?? undefined,
      activeVocab: activeTurnRef.current
        ? store.state.glossary.filter((g) => activeTurnRef.current!.vocab.includes(g.id))
        : undefined,
    }),
    [
      store.state.screen,
      store.state.setupStep,
      store.state.summary,
      store.state.script,
      store.state.glossary,
    ],
  );

  /* Latest broadcast function — read via ref inside WS handlers to avoid stale
     closures. Only the stage broadcasts; the hub does not relay our own state. */
  const broadcastFnRef = useRef<() => void>(() => {});
  broadcastFnRef.current = () => {
    if (!rolesRef.current.includes("stage")) return;
    hubRef.current?.send({ type: "state", snapshot: buildSnapshot() });
  };

  const broadcastTimerRef = useRef<number | null>(null);
  const broadcastSoon = useCallback(() => {
    if (broadcastTimerRef.current !== null) return;
    broadcastTimerRef.current = window.setTimeout(() => {
      broadcastTimerRef.current = null;
      broadcastFnRef.current();
    }, 120);
  }, []);

  const handleIncomingUpload = useCallback(
    async (uploadId: string, filename: string) => {
      try {
        const dataUrl = await fetchUploadDataUrl(uploadId);
        setPendingUploads((prev) => {
          if (prev.some((p) => p.uploadId === uploadId)) return prev;
          return [...prev, { uploadId, filename, dataUrl, mimeType: dataUrlMime(dataUrl) }].slice(
            -MAX_PENDING_UPLOADS,
          );
        });
      } catch {
        /* upload expired or already consumed — ignore */
      }
    },
    [],
  );

  const handleMessage = useCallback(
    (msg: WsServerMessage) => {
      switch (msg.type) {
        case "joined":
          rolesRef.current = msg.roles;
          setRoles(msg.roles);
          setDeviceId(msg.deviceId);
          if (msg.snapshot) setSnapshot(msg.snapshot);
          if (msg.roles.includes("stage")) broadcastFnRef.current();
          break;
        case "devices":
          setDevices(msg.devices);
          break;
        case "state":
          setSnapshot(msg.snapshot);
          break;
        case "control":
          for (const listener of controlListenersRef.current) listener(msg);
          break;
        case "turn":
          for (const listener of turnListenersRef.current) listener(msg);
          break;
        case "phase":
          for (const listener of phaseListenersRef.current) listener(msg);
          break;
        case "upload":
          void handleIncomingUpload(msg.uploadId, msg.filename);
          break;
        case "ack":
          setSentUploadIds((ids) => ids.filter((id) => id !== msg.uploadId));
          break;
        case "error":
          setHubError(msg.message);
          break;
        default:
          break;
      }
    },
    [handleIncomingUpload],
  );

  const connectHub = useCallback(
    (wsUrl: string, pairingToken: string, capabilities: DeviceCapability[], sessionId?: string) => {
      hubRef.current?.close();
      const hub = new HubClient(wsUrl);
      hubRef.current = hub;
      hub.onStatusChange = setHubStatus;
      hub.subscribe(handleMessage);
      hub.connect({
        type: "join",
        ...(sessionId ? { sessionId } : {}),
        pairingToken,
        capabilities,
      });
    },
    [handleMessage],
  );

  function ensureSession(): Promise<SessionSummary | null> {
    if (!ensurePromiseRef.current) {
      ensurePromiseRef.current = (async () => {
        try {
          const existing = await getCurrentSession();
          if (existing) return existing;
          return await createSession();
        } finally {
          ensurePromiseRef.current = null;
        }
      })();
    }
    return ensurePromiseRef.current;
  }

  useEffect(() => {
    if (isPhone) {
      if (!phoneJoin) {
        // No pairing code yet — PhoneApp shows a manual-entry form.
        return;
      }
      connectHub(
        wsUrlFromOrigin(window.location.origin),
        phoneJoin.pairingToken,
        [...COMPANION_CAPABILITIES],
        phoneJoin.sessionId,
      );
      return () => {
        hubRef.current?.close();
      };
    }

    let disposed = false;
    ensureSession()
      .then((s) => {
        if (disposed || !s) return;
        sessionRef.current = s;
        setSession(s);
        setHubError(null);
        connectHub(s.wsUrl, s.pairingToken, [...STAGE_CAPABILITIES], s.id);
      })
      .catch((err: unknown) => {
        setHubError(err instanceof Error ? err.message : "Could not start the session.");
      });
    return () => {
      disposed = true;
      hubRef.current?.close();
    };
  }, [isPhone, phoneJoin, connectHub]);

  /* Re-broadcast when local app state changes (the hub relays to companions). */
  useEffect(() => {
    broadcastSoon();
  }, [store.state, broadcastSoon]);

  const ackPendingUpload = useCallback((uploadId: string) => {
    hubRef.current?.send({ type: "ack", uploadId });
    setPendingUploads((prev) => prev.filter((p) => p.uploadId !== uploadId));
  }, []);

  const uploadFromCompanion = useCallback(async (page: ImageDoc) => {
    const result = await uploadPage({
      filename: `page-${Date.now()}.jpg`,
      mimeType: page.mimeType,
      dataUrl: page.dataUrl,
    });
    setSentUploadIds((ids) => [...ids, result.uploadId]);
    hubRef.current?.send({ type: "upload", uploadId: result.uploadId, filename: result.filename });
    return result.uploadId;
  }, []);

  const sendControl = useCallback((action: ControlAction, entryId?: string) => {
    hubRef.current?.send({
      type: "control",
      action,
      ...(entryId ? { entryId } : {}),
    });
  }, []);

  const onControl = useCallback((listener: ControlListener) => {
    controlListenersRef.current.add(listener);
    return () => controlListenersRef.current.delete(listener);
  }, []);

  const onTurn = useCallback((listener: TurnListener) => {
    turnListenersRef.current.add(listener);
    return () => turnListenersRef.current.delete(listener);
  }, []);

  const onPhase = useCallback((listener: PhaseListener) => {
    phaseListenersRef.current.add(listener);
    return () => phaseListenersRef.current.delete(listener);
  }, []);

  const sendPushToTalk = useCallback(async (audio: { audioBase64: string; mimeType?: string }) => {
    const { uploadId } = await uploadAudio(audio);
    hubRef.current?.send({
      type: "audio",
      audioId: uploadId,
      mimeType: audio.mimeType ?? "audio/wav",
    });
  }, []);

  const setPlayerState = useCallback(
    (state: PlayerState | undefined) => {
      playerStateRef.current = state;
      broadcastSoon();
    },
    [broadcastSoon],
  );

  const setActiveTurn = useCallback(
    (turn: Turn | null) => {
      activeTurnRef.current = turn;
      broadcastSoon();
    },
    [broadcastSoon],
  );

  const rotatePairing = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    const updated = await rotatePairingApi(current.id);
    sessionRef.current = updated;
    setSession(updated);
    connectHub(updated.wsUrl, updated.pairingToken, [...STAGE_CAPABILITIES], updated.id);
  }, [connectHub]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      hubStatus,
      hubError,
      devices,
      roles,
      deviceId,
      isStage: roles.includes("stage"),
      isPhone,
      snapshot,
      pendingUploads,
      sentUploadIds,
      setPlayerState,
      setActiveTurn,
      onControl,
      onTurn,
      onPhase,
      ackPendingUpload,
      uploadFromCompanion,
      sendControl,
      sendPushToTalk,
      rotatePairing,
    }),
    [
      session,
      hubStatus,
      hubError,
      devices,
      roles,
      deviceId,
      isPhone,
      snapshot,
      pendingUploads,
      sentUploadIds,
      setPlayerState,
      setActiveTurn,
      onControl,
      onTurn,
      onPhase,
      ackPendingUpload,
      uploadFromCompanion,
      sendControl,
      sendPushToTalk,
      rotatePairing,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
