import type React from "react";
import { useCallback, useState } from "react";

import { getConnectToken } from "@/lib/api";
import { isByoEnabled, synthesizeSpeech } from "@/lib/tts";
import type {
  CameraAngle,
  PresentOptions,
  PresentationResult,
} from "@/lib/presenter";
import {
  usePresenter,
  type PresenterEventName,
  type PresenterEventHandler,
} from "./use-presenter";

export interface LaunchParams {
  avatarId: string;
  sceneId: string;
  /** Optional — the presenter works without a voice configured. */
  voiceId?: string;
}

export interface AvatarSession {
  engineReady: boolean;
  ready: boolean;
  loadError: Error | null;
  retryLoad: () => void;
  launch: (params: LaunchParams) => Promise<void>;
  isLaunching: boolean;
  launchError: Error | null;
  /** UI-facing: resume audio, then speak `text`. Throws on a failed playback. */
  speak: (text: string) => Promise<void>;
  isSpeaking: boolean;
  speakError: Error | null;
  /** Low-level presenter passthroughs (used by the script player). */
  present: (
    content: string,
    options?: PresentOptions,
  ) => Promise<PresentationResult | undefined>;
  /** Play caller-provided audio (BYO TTS) on the avatar with `content` as the transcript. */
  presentWithAudio: (
    audio: ArrayBuffer,
    content: string,
    options?: PresentOptions,
  ) => Promise<PresentationResult | undefined>;
  /** Play a single motion clip (e.g. eager attention gestures). */
  playMotion: (motionId: string) => Promise<PresentationResult | undefined>;
  resumeAudio: () => Promise<void>;
  interrupt: () => void;
  /** Avatar state controls (real-conversation loop). */
  setListening: (isListening: boolean) => void;
  setThinking: (isThinking: boolean) => void;
  muteAudio: (muted: boolean) => void;
  updateCameraAngle: (angle: CameraAngle) => void;
  subscribe: (event: PresenterEventName, handler: PresenterEventHandler) => () => void;
}

/**
 * Bridges the Connect API with the imperative presenter.
 *
 * - `launch` mints a Connect token from the backend proxy (which holds the
 *   shared identity in env), then initializes the presenter with the chosen
 *   avatar/scene/voice.
 * - `speak` resumes the AudioContext (from this user-gesture click) and calls
 *   `presenter.present(text)`.
 * - On `CONNECT_TOKEN_EXPIRED` the token is re-minted and rotated via
 *   `refreshConnectToken` — no user login involved.
 */
export function useAvatarSession(
  stageRef: React.RefObject<HTMLDivElement | null>,
): AvatarSession {
  const presenter = usePresenter({
    stageRef,
    onConnectTokenExpired: () => {
      void (async () => {
        try {
          const { connect_token } = await getConnectToken();
          presenter.refreshConnectToken(connect_token);
        } catch {
          /* re-mint failed (e.g. backend down) — next present() will surface it */
        }
      })();
    },
  });

  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<Error | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakError, setSpeakError] = useState<Error | null>(null);

  const launch = useCallback(
    async ({ avatarId, sceneId, voiceId }: LaunchParams) => {
      setIsLaunching(true);
      setLaunchError(null);
      try {
        const { connect_token } = await getConnectToken();
        await presenter.initialize(connect_token, { avatarId, sceneId, voiceId });
      } catch (err) {
        setLaunchError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setIsLaunching(false);
      }
    },
    [presenter],
  );

  const present = useCallback(
    async (content: string, options?: PresentOptions) => {
      // BYO TTS (Phase 5f): synthesize server-side and play the WAV instead of
      // Perxona's voice. Falls back to the built-in voice if synthesis fails.
      if (isByoEnabled()) {
        try {
          const wav = await synthesizeSpeech(content);
          return await presenter.presentWithAudio(wav, content, options);
        } catch {
          /* fall through to Perxona speech */
        }
      }
      return presenter.present(content, options);
    },
    [presenter],
  );

  const presentWithAudio = useCallback(
    async (audio: ArrayBuffer, content: string, options?: PresentOptions) =>
      presenter.presentWithAudio(audio, content, options),
    [presenter],
  );

  const speak = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || !presenter.ready) return;
      setIsSpeaking(true);
      setSpeakError(null);
      try {
        // Resume AudioContext from this user-gesture click before synthesizing.
        await presenter.resumeAudio();
        const result = await presenter.present(message);
        if (result && !result.success) {
          throw new Error(
            `Playback failed (${result.code}): ${result.message ?? ""}`,
          );
        }
      } catch (err) {
        setSpeakError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setIsSpeaking(false);
      }
    },
    [presenter],
  );

  const playMotion = useCallback(
    (motionId: string) => presenter.playMotion(motionId),
    [presenter],
  );

  const resumeAudio = useCallback(
    () => presenter.resumeAudio(),
    [presenter],
  );

  const setListening = useCallback(
    (isListening: boolean) => presenter.setListening(isListening),
    [presenter],
  );

  const setThinking = useCallback(
    (isThinking: boolean) => presenter.setThinking(isThinking),
    [presenter],
  );

  const muteAudio = useCallback(
    (muted: boolean) => presenter.muteAudio(muted),
    [presenter],
  );

  const updateCameraAngle = useCallback(
    (angle: CameraAngle) => presenter.updateCameraAngle(angle),
    [presenter],
  );

  const interrupt = useCallback(() => {
    presenter.interruptPresentation();
  }, [presenter]);

  const subscribe = useCallback(
    (event: PresenterEventName, handler: PresenterEventHandler) =>
      presenter.subscribe(event, handler),
    [presenter],
  );

  return {
    engineReady: presenter.mounted,
    ready: presenter.ready,
    loadError: presenter.loadError,
    retryLoad: presenter.retry,
    launch,
    isLaunching,
    launchError,
    speak,
    isSpeaking,
    speakError,
    present,
    presentWithAudio,
    playMotion,
    resumeAudio,
    setListening,
    setThinking,
    muteAudio,
    updateCameraAngle,
    interrupt,
    subscribe,
  };
}
