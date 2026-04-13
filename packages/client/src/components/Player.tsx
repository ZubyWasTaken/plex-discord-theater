import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { HlsJsP2PEngine } from "p2p-media-loader-hlsjs";
import { Controls } from "./Controls";
import { hlsMasterUrl, pingSession, stopSession, getSessionToken, fetchConfig } from "../lib/api";
import type { PlexItem } from "../lib/api";
import type { SyncState, SyncActions } from "../hooks/useSync";

const PING_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const DRIFT_THRESHOLD_S = 2;
const HEARTBEAT_DRIFT_THRESHOLD_S = 3;
const MAX_VIEWER_RETRIES = 3;
const MAX_NETWORK_RETRIES = 5;

interface PlayerProps {
  item: PlexItem;
  isHost: boolean;
  subtitles: boolean;
  onBack: () => void;
  syncState?: SyncState;
  syncActions?: SyncActions;
}

export function Player({ item, isHost, subtitles, onBack, syncState, syncActions }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [vpsRelay, setVpsRelay] = useState<boolean | null>(null); // null = not yet loaded
  const retryCountRef = useRef(0);
  const hlsDeadRef = useRef(false);
  const networkRetryRef = useRef(0);
  const pendingStopRef = useRef<Promise<void> | null>(null);

  // Stable refs so the HLS effect doesn't re-run when these change
  const syncActionsRef = useRef(syncActions);
  syncActionsRef.current = syncActions;
  const syncStateRef = useRef(syncState);
  syncStateRef.current = syncState;

  // Refs for isHost/ownsSession so the main HLS effect doesn't re-run on promotion.
  // The promoted host should keep the existing HLS stream, not tear it down.
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const ownsSessionRef = useRef(isHost);

  // Whether this Player mounted as host — controls viewerHlsSessionId computation.
  // Using a mount-time ref prevents promotion from flipping the value to null
  // (which would trigger a full HLS teardown/rebuild and reset to 0:00).
  const mountedAsHostRef = useRef(isHost);

  // For the viewer, tracks the host's HLS session ID from sync state.
  // For the host, always null — prevents spurious effect re-runs that would
  // generate a new UUID and orphan the running Plex transcode.
  const viewerHlsSessionId = mountedAsHostRef.current ? null : (syncState?.hlsSessionId ?? null);

  // Handle promotion: start ping + heartbeat when viewer becomes host mid-playback
  useEffect(() => {
    if (!isHost || ownsSessionRef.current) return;

    // Promoted to host — take over session ownership
    ownsSessionRef.current = true;

    // Start pinging to keep transcode alive (the old host was doing this)
    if (pingIntervalRef.current === null) {
      pingIntervalRef.current = setInterval(() => {
        if (sessionIdRef.current) {
          pingSession(sessionIdRef.current).catch(console.error);
        }
      }, PING_INTERVAL_MS);
    }

    // Start heartbeating to sync remaining viewers
    if (heartbeatIntervalRef.current === null) {
      heartbeatIntervalRef.current = setInterval(() => {
        const v = videoRef.current;
        if (v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          syncActionsRef.current?.sendHeartbeat(v.currentTime, !v.paused);
        }
      }, HEARTBEAT_INTERVAL_MS);
    }
  }, [isHost]);

  const destroyLocal = useCallback(() => {
    if (pingIntervalRef.current !== null) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (heartbeatIntervalRef.current !== null) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  // Fetch VPS relay config once on mount — HLS init waits for this
  useEffect(() => {
    fetchConfig()
      .then((config) => setVpsRelay(config.vpsRelay))
      .catch(() => setVpsRelay(false)); // default to non-VPS (P2P mode) if config fails
  }, []);

  // Single HLS session — no mid-stream switching
  useEffect(() => {
    let mounted = true;

    destroyLocal();

    // Host creates a new session; viewer reuses the host's session
    const sessionOwner = ownsSessionRef.current;
    const sessionId = sessionOwner
      ? crypto.randomUUID()
      : viewerHlsSessionId;

    if (!sessionId) {
      // Viewer doesn't have a session ID yet — wait for sync
      return;
    }

    sessionIdRef.current = sessionId;

    const url = hlsMasterUrl(item.ratingKey, sessionId, { subtitles });

    async function start() {
      if (pendingStopRef.current) {
        try { await pendingStopRef.current; } catch {}
        pendingStopRef.current = null;
        // Give Plex time to fully release transcode resources
        await new Promise(r => setTimeout(r, 500));
      }

      // Wait for VPS config before initializing HLS — prevents double-start
      // (P2P init on false default, then teardown+re-init when config arrives)
      if (vpsRelay === null) return;

      const video = videoRef.current;
      if (!mounted || !video) return;

      if (Hls.isSupported()) {
        const token = getSessionToken();

        const hlsConfig: Partial<import("hls.js").HlsConfig> = {
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          manifestLoadingMaxRetry: 4,
          manifestLoadingRetryDelay: 1000,
          manifestLoadingMaxRetryTimeout: 30000,
          levelLoadingMaxRetry: 6,
          levelLoadingRetryDelay: 1000,
          fragLoadingMaxRetry: 8,
          fragLoadingRetryDelay: 1000,
          fragLoadingMaxRetryTimeout: 30000,
          startFragPrefetch: true,
          xhrSetup: (xhr: XMLHttpRequest, urlStr: string) => {
            // Only send auth header to same-origin requests (manifests, pings).
            // VPS segment URLs are absolute (https://vps/seg/...) and authenticated
            // via ?key= query param. Sending Authorization to a cross-origin URL
            // triggers a CORS preflight that nginx's ?key= check would reject.
            const isSameOrigin = urlStr.startsWith("/") || urlStr.startsWith(location.origin);
            if (token && isSameOrigin) {
              xhr.setRequestHeader("Authorization", `Bearer ${token}`);
            }
          },
        };

        let hls: Hls;

        if (!vpsRelay) {
          // P2P mode — peers share segments via WebRTC
          const HlsWithP2P = HlsJsP2PEngine.injectMixin(Hls);
          hls = new HlsWithP2P({
            ...hlsConfig,
            p2p: {
              core: {
                swarmId: `pdt-${sessionId}`,
                announceTrackers: [
                  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/tracker${token ? `?token=${encodeURIComponent(token)}` : ""}`,
                ],
                highDemandTimeWindow: 15,
                p2pDownloadTimeWindow: 30,
                httpDownloadTimeWindow: 6,
                simultaneousP2PDownloads: 3,
                simultaneousHttpDownloads: 2,
                rtcConfig: {
                  iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                  ],
                },
                httpRequestSetup: async (url, _byteRange, signal, requestByteRange) => {
                  const headers: Record<string, string> = {};
                  if (token) headers["Authorization"] = `Bearer ${token}`;
                  if (requestByteRange) {
                    const end = requestByteRange.end != null ? requestByteRange.end : "";
                    headers["Range"] = `bytes=${requestByteRange.start}-${end}`;
                  }
                  return new Request(url, { headers, signal });
                },
              },
              onHlsJsCreated: (hls) => {
                hls.p2pEngine.addEventListener("onTrackerError", ({ error }) => {
                  console.error("[P2P] Tracker error:", error);
                });
              },
            },
          });
        } else {
          // VPS mode — segments come from VPS cache, no P2P needed
          hls = new Hls(hlsConfig);
        }

        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!mounted) return;

          // Viewer joining mid-playback: seek to host's position immediately
          // instead of waiting for the 5s heartbeat drift threshold
          if (!isHostRef.current && syncActionsRef.current) {
            const syncPos = syncStateRef.current?.position;
            if (syncPos && syncPos > DRIFT_THRESHOLD_S) {
              video.currentTime = syncPos;
            }
          }

          video.play().catch((err) => console.warn("Autoplay prevented:", err));

          // Host: broadcast play with sessionId when manifest is ready
          if (isHostRef.current) {
            syncActionsRef.current?.sendPlay(item.ratingKey, item.title, subtitles, sessionId!);
          }
        });

        // Clear error banner and reset retry count when recovery succeeds
        hls.on(Hls.Events.FRAG_LOADED, () => {
          if (mounted) {
            setError(null);
            retryCountRef.current = 0;
            networkRetryRef.current = 0;
            hlsDeadRef.current = false;
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.error("HLS fatal error:", data);
            if (mounted) setError(`Playback error: ${data.type}`);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetryRef.current < MAX_NETWORK_RETRIES) {
              networkRetryRef.current++;
              hls.startLoad();
            } else if (!ownsSessionRef.current && retryCountRef.current < MAX_VIEWER_RETRIES) {
              // Viewer: retry by bumping retryKey after a delay (re-runs the effect)
              retryCountRef.current++;
              console.warn(`[Viewer] HLS fatal error, retry ${retryCountRef.current}/${MAX_VIEWER_RETRIES} in 2s`);
              setTimeout(() => {
                if (mounted) setRetryKey((k) => k + 1);
              }, 2000);
            } else {
              destroyLocal();
              if (ownsSessionRef.current && sessionIdRef.current) {
                pendingStopRef.current = stopSession(sessionIdRef.current).catch(() => {});
                sessionIdRef.current = null;
              }
              if (!ownsSessionRef.current) {
                hlsDeadRef.current = true;
              }
            }
          }
        });

        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        const token = getSessionToken();
        const sep = url.includes("?") ? "&" : "?";
        const nativeUrl = token ? `${url}${sep}token=${encodeURIComponent(token)}` : url;
        video.src = nativeUrl;
        const onLoaded = () => {
          if (!mounted) return;
          video.play().catch((err) => console.warn("Autoplay prevented:", err));
          if (isHostRef.current) {
            syncActionsRef.current?.sendPlay(item.ratingKey, item.title, subtitles, sessionId!);
          }
        };
        video.addEventListener("loadedmetadata", onLoaded, { once: true });
      } else {
        setError("HLS playback is not supported in this browser");
        return;
      }

      // Only the session owner pings to keep the transcode alive
      if (sessionOwner) {
        pingIntervalRef.current = setInterval(() => {
          if (sessionIdRef.current) {
            pingSession(sessionIdRef.current).catch(console.error);
          }
        }, PING_INTERVAL_MS);
      }

      // Host: heartbeat every 5s (guard against double-start if promotion effect already set one)
      if (isHostRef.current && heartbeatIntervalRef.current === null) {
        heartbeatIntervalRef.current = setInterval(() => {
          const v = videoRef.current;
          if (v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            syncActionsRef.current?.sendHeartbeat(v.currentTime, !v.paused);
          }
        }, HEARTBEAT_INTERVAL_MS);
      }
    }

    start();

    return () => {
      mounted = false;
      destroyLocal();
      // Only the session owner stops the Plex transcode
      if (ownsSessionRef.current && sessionIdRef.current) {
        pendingStopRef.current = stopSession(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
    };
  }, [item.ratingKey, subtitles, destroyLocal, viewerHlsSessionId, retryKey, vpsRelay]);

  // Viewer: respond to explicit host commands (play/pause/resume/seek)
  // Does NOT fire on heartbeats — both clients share the same HLS stream
  // so they naturally stay in sync without constant seeking.
  useEffect(() => {
    if (isHostRef.current || !syncState || syncState.commandSeq === 0) return;

    // Viewer recovery: if HLS died after exhausting retries, a new host command
    // means the stream may be alive again — reset and retry
    if (hlsDeadRef.current) {
      hlsDeadRef.current = false;
      retryCountRef.current = 0;
      setRetryKey((k) => k + 1);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    // Sync play/pause state
    if (syncState.playing && video.paused) {
      video.play().catch(() => {});
    } else if (!syncState.playing && !video.paused) {
      video.pause();
    }

    // Seek correction — only on explicit commands, with generous threshold
    if (syncState.position > 0) {
      const drift = Math.abs(video.currentTime - syncState.position);
      if (drift > DRIFT_THRESHOLD_S) {
        video.currentTime = syncState.position;
      }
    }
  }, [syncState?.commandSeq]);

  // Viewer: periodic drift correction on heartbeats (larger threshold than explicit commands).
  // Also fires on explicit command position updates, but the command-based effect above
  // already corrects at a tighter 2s threshold, making this a no-op in that case.
  useEffect(() => {
    if (isHostRef.current || !syncState) return;
    const video = videoRef.current;
    if (!video || !syncState.playing || video.paused) return;
    if (syncState.position <= 0) return;

    const drift = Math.abs(video.currentTime - syncState.position);
    if (drift > HEARTBEAT_DRIFT_THRESHOLD_S) {
      console.warn(`[Viewer] Heartbeat drift correction: ${drift.toFixed(1)}s`);
      video.currentTime = syncState.position;
    }
  }, [syncState?.position]);

  const handleBack = useCallback(() => {
    destroyLocal();
    // Only the session owner stops the Plex transcode
    if (ownsSessionRef.current && sessionIdRef.current) {
      pendingStopRef.current = stopSession(sessionIdRef.current).catch(() => {});
      sessionIdRef.current = null;
    }
    if (isHostRef.current) {
      syncActionsRef.current?.sendStop();
    }
    onBack();
  }, [destroyLocal, onBack]);

  return (
    <div style={styles.container}>
      {syncState?.authFailed ? (
        <div style={styles.error}>Session expired — please close and restart the activity</div>
      ) : syncState?.reconnectFailed ? (
        <div style={styles.error}>Connection lost — please close and restart the activity</div>
      ) : error ? (
        <div style={styles.error}>{error}</div>
      ) : syncState?.hostDisconnected ? (
        <div style={styles.hostDisconnected}>Host disconnected — waiting for reconnection...</div>
      ) : null}

      <video
        ref={videoRef}
        style={styles.video}
        playsInline
      />

      <Controls
        videoRef={videoRef}
        isHost={isHost}
        title={item.title}
        onBack={handleBack}
        onSyncPause={isHost ? syncActions?.sendPause : undefined}
        onSyncResume={isHost ? syncActions?.sendResume : undefined}
        onSyncSeek={isHost ? syncActions?.sendSeek : undefined}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    inset: 0,
    background: "#000",
    overflow: "hidden",
    zIndex: 50,
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  error: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    background: "#c0392b",
    color: "#fff",
    padding: "8px 16px",
    textAlign: "center",
    fontSize: "14px",
    zIndex: 20,
  },
  hostDisconnected: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    background: "#e67e22",
    color: "#fff",
    padding: "8px 16px",
    textAlign: "center",
    fontSize: "14px",
    zIndex: 20,
  },
};
