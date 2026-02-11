import { useState, useEffect, useRef, useCallback } from "react";
import { getSessionToken } from "../lib/api";

export interface SyncState {
  connected: boolean;
  ratingKey: string | null;
  title: string | null;
  subtitles: boolean;
  playing: boolean;
  position: number;
  hostDisconnected: boolean;
}

export interface SyncActions {
  sendPlay: (ratingKey: string, title: string, subtitles: boolean) => void;
  sendPause: (position: number) => void;
  sendResume: (position: number) => void;
  sendSeek: (position: number) => void;
  sendStop: () => void;
  sendHeartbeat: (position: number, playing: boolean) => void;
}

interface UseSyncOptions {
  instanceId: string | null;
  userId: string | null;
  enabled: boolean;
}

const INITIAL_STATE: SyncState = {
  connected: false,
  ratingKey: null,
  title: null,
  subtitles: false,
  playing: false,
  position: 0,
  hostDisconnected: false,
};

export function useSync({ instanceId, userId, enabled }: UseSyncOptions): {
  state: SyncState;
  actions: SyncActions;
} {
  const [state, setState] = useState<SyncState>(INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const actions: SyncActions = {
    sendPlay: useCallback(
      (ratingKey: string, title: string, subtitles: boolean) =>
        send({ type: "play", ratingKey, title, subtitles }),
      [send],
    ),
    sendPause: useCallback(
      (position: number) => send({ type: "pause", position }),
      [send],
    ),
    sendResume: useCallback(
      (position: number) => send({ type: "resume", position }),
      [send],
    ),
    sendSeek: useCallback(
      (position: number) => send({ type: "seek", position }),
      [send],
    ),
    sendStop: useCallback(() => send({ type: "stop" }), [send]),
    sendHeartbeat: useCallback(
      (position: number, playing: boolean) =>
        send({ type: "heartbeat", position, playing }),
      [send],
    ),
  };

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled || !instanceId || !userId) return;

    function connect() {
      const token = getSessionToken();
      if (!token) return;

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}/ws`);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (!mountedRef.current) return;
        retryRef.current = 0;
        ws.send(
          JSON.stringify({
            type: "join",
            sessionToken: token,
            instanceId,
            userId,
          }),
        );
        setState((prev) => ({ ...prev, connected: true, hostDisconnected: false }));
      });

      ws.addEventListener("message", (event) => {
        if (!mountedRef.current) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }

        switch (msg.type) {
          case "state":
            setState((prev) => ({
              ...prev,
              ratingKey: (msg.ratingKey as string) || null,
              title: (msg.title as string) || null,
              subtitles: Boolean(msg.subtitles),
              playing: Boolean(msg.playing),
              position: (msg.position as number) ?? 0,
            }));
            break;
          case "play":
            setState((prev) => ({
              ...prev,
              ratingKey: (msg.ratingKey as string) || null,
              title: (msg.title as string) || null,
              subtitles: Boolean(msg.subtitles),
              playing: true,
              position: 0,
              hostDisconnected: false,
            }));
            break;
          case "pause":
            setState((prev) => ({
              ...prev,
              playing: false,
              position: (msg.position as number) ?? prev.position,
            }));
            break;
          case "resume":
            setState((prev) => ({
              ...prev,
              playing: true,
              position: (msg.position as number) ?? prev.position,
            }));
            break;
          case "seek":
            setState((prev) => ({
              ...prev,
              position: (msg.position as number) ?? prev.position,
            }));
            break;
          case "stop":
            setState((prev) => ({
              ...prev,
              ratingKey: null,
              title: null,
              playing: false,
              position: 0,
            }));
            break;
          case "heartbeat":
            setState((prev) => ({
              ...prev,
              position: (msg.position as number) ?? prev.position,
              playing: msg.playing !== false,
            }));
            break;
          case "host-disconnected":
            setState((prev) => ({ ...prev, hostDisconnected: true }));
            break;
          case "host-reconnected":
            setState((prev) => ({ ...prev, hostDisconnected: false }));
            break;
        }
      });

      ws.addEventListener("close", () => {
        if (!mountedRef.current) return;
        wsRef.current = null;
        setState((prev) => ({ ...prev, connected: false }));

        // Reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 15000);
        retryRef.current++;
        retryTimerRef.current = setTimeout(connect, delay);
      });

      ws.addEventListener("error", () => {
        // close event will fire after this, triggering reconnect
      });
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, instanceId, userId]);

  return { state, actions };
}
