import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

import {
  loadPresenterEngine,
  type CameraAngle,
  type PresentOptions,
  type Presenter,
  type PresentationResult,
  type PresentationTarget,
} from "@/lib/presenter";

export type PresenterEventName =
  | "PRESENTER_STATUS"
  | "CONNECT_TOKEN_EXPIRED"
  | "SPEECH_TOKEN_EXPIRED"
  | "ASSET_LOADING_PROGRESS"
  | "AUDIO_PLAYBACK_STATE"
  | "PLAYING_SPEECH_TEXT"
  | "PERFORMANCE_STATE"
  | "PERFORMANCE_START"
  | "PERFORMANCE_END"
  | "ALL_PERFORMANCE_FINISHED";

export type PresenterEventHandler = (event: CustomEvent<unknown>) => void;

export interface UsePresenterOptions {
  stageRef: React.RefObject<HTMLDivElement | null>;
  onConnectTokenExpired?: () => void;
}

export interface UsePresenter {
  /** True once the engine is loaded and the `<sv-presenter>` element is mounted. */
  mounted: boolean;
  ready: boolean;
  loadError: Error | null;
  retry: () => void;
  resumeAudio: () => Promise<void>;
  initialize: (
    connectToken: string,
    target: PresentationTarget,
  ) => Promise<void>;
  present: (
    content: string,
    options?: PresentOptions,
  ) => Promise<PresentationResult | undefined>;
  presentWithAudio: (
    audio: ArrayBuffer,
    content: string,
    options?: PresentOptions,
  ) => Promise<PresentationResult | undefined>;
  interruptPresentation: () => void;
  refreshConnectToken: (token: string) => void;
  playMotion: (motionId: string) => Promise<PresentationResult | undefined>;
  setListening: (isListening: boolean) => void;
  setThinking: (isThinking: boolean) => void;
  muteAudio: (muted: boolean) => void;
  updateCameraAngle: (angle: CameraAngle) => void;
  /** Attach a listener to a presenter element event. Safe before mount. */
  subscribe: (event: PresenterEventName, handler: PresenterEventHandler) => () => void;
}

/**
 * Owns the imperative `<sv-presenter>` web component lifecycle: loads the engine
 * once, mounts the element into `stageRef`, wires status/token events, and
 * exposes typed imperative methods. The presenter is stateful and event-driven,
 * not a fetchable resource, so it lives outside any query layer.
 */
export function usePresenter(options: UsePresenterOptions): UsePresenter {
  const { stageRef } = options;
  const presenterRef = useRef<Presenter | null>(null);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const onExpiredRef = useRef(options.onConnectTokenExpired);
  useEffect(() => {
    onExpiredRef.current = options.onConnectTokenExpired;
  });

  // Subscribers survive remounts: re-attached whenever a fresh element mounts.
  const listenersRef = useRef(new Map<PresenterEventName, Set<PresenterEventHandler>>());

  useEffect(() => {
    let disposed = false;
    const stage = stageRef.current;

    async function mount() {
      try {
        setLoadError(null);
        await loadPresenterEngine();
        if (disposed || !stage) return;

        const el = document.createElement("sv-presenter") as Presenter;
        el.hidden = true;
        el.style.width = "100%";
        el.style.height = "100%";

        for (const [event, handlers] of listenersRef.current) {
          for (const handler of handlers) {
            el.addEventListener(event, handler as EventListener);
          }
        }

        el.addEventListener("PRESENTER_STATUS", ((event: CustomEvent<{ status: string }>) => {
          const { status: next } = event.detail;
          if (next === "Ready") {
            el.hidden = false;
            setReady(true);

            // Avoid the default 90° vertical FOV, which is too narrow for most scenes.
            el.updateCameraFOV({ distance: 1, vertical: 0, horizontal: 4.5 });

            // On first mount the element goes from hidden (0x0) to visible, which
            // is itself a ResizeObserver-detectable change. On re-initialization
            // (e.g. swapping avatars) the element is already visible at the same
            // size, so that resize logic never re-fires and the canvas keeps a
            // stale scale. Nudge the width by a pixel and back to force it.
            const width = el.style.width;
            el.style.width = "calc(100% - 1px)";
            requestAnimationFrame(() => {
              el.style.width = width;
            });
          } else {
            setReady(false);
          }
        }) as EventListener);

        el.addEventListener("CONNECT_TOKEN_EXPIRED", (() => {
          onExpiredRef.current?.();
        }) as EventListener);

        stage.append(el);
        presenterRef.current = el;
        setMounted(true);
      } catch (err) {
        if (!disposed) {
          const error = err instanceof Error ? err : new Error(String(err));
          setLoadError(error);
        }
      }
    }

    void mount();
    return () => {
      disposed = true;
      presenterRef.current?.remove();
      presenterRef.current = null;
      setMounted(false);
    };
  }, [stageRef, retryCount]);

  const retry = useCallback(() => {
    setRetryCount((count) => count + 1);
  }, []);

  const subscribe = useCallback(
    (event: PresenterEventName, handler: PresenterEventHandler) => {
      let handlers = listenersRef.current.get(event);
      if (!handlers) {
        handlers = new Set();
        listenersRef.current.set(event, handlers);
      }
      handlers.add(handler);
      presenterRef.current?.addEventListener(event, handler as EventListener);
      return () => {
        handlers!.delete(handler);
        presenterRef.current?.removeEventListener(event, handler as EventListener);
      };
    },
    [],
  );

  const resumeAudio = useCallback(async () => {
    await presenterRef.current?.resumeAudioPlayback();
  }, []);

  const initialize = useCallback(
    async (connectToken: string, target: PresentationTarget) => {
      await presenterRef.current?.initialize(connectToken, target);
    },
    [],
  );

  const present = useCallback(
    async (content: string, options?: PresentOptions) => {
      return presenterRef.current?.present(content, options);
    },
    [],
  );

  const presentWithAudio = useCallback(
    async (audio: ArrayBuffer, content: string, options?: PresentOptions) => {
      return presenterRef.current?.presentWithAudio(audio, content, options);
    },
    [],
  );

  const playMotion = useCallback(async (motionId: string) => {
    return presenterRef.current?.playMotion(motionId);
  }, []);

  const setListening = useCallback((isListening: boolean) => {
    presenterRef.current?.setListening(isListening);
  }, []);

  const setThinking = useCallback((isThinking: boolean) => {
    presenterRef.current?.setThinking(isThinking);
  }, []);

  const muteAudio = useCallback((muted: boolean) => {
    presenterRef.current?.muteAudio(muted);
  }, []);

  const updateCameraAngle = useCallback((angle: CameraAngle) => {
    presenterRef.current?.updateCameraAngle(angle);
  }, []);

  const interruptPresentation = useCallback(() => {
    presenterRef.current?.interruptPresentation();
  }, []);

  const refreshConnectToken = useCallback((token: string) => {
    presenterRef.current?.refreshConnectToken(token);
  }, []);

  return {
    mounted,
    ready,
    loadError,
    retry,
    resumeAudio,
    initialize,
    present,
    presentWithAudio,
    playMotion,
    setListening,
    setThinking,
    muteAudio,
    updateCameraAngle,
    interruptPresentation,
    refreshConnectToken,
    subscribe,
  };
}
