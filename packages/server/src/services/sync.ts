import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "http";
import { isValidSession } from "../middleware/auth.js";
import { instanceHosts } from "../routes/discord.js";
import { plexFetch } from "./plex.js";
import { getPlexTranscodeKey, getSessionClientId, getSessionRatingKey, markTranscodeStopped, notifyPlexStopped } from "../routes/plex.js";
import { createTracker, handleTrackerSocket, destroyTracker } from "./tracker.js";

/** Interval between WebSocket pings to detect dead connections. */
const WS_PING_INTERVAL_MS = 30_000;

/**
 * Stop a Plex transcode using the mapped Plex internal key.
 * Our session UUID differs from Plex's internal transcode key, so we use
 * the mapping populated when the manifest was first fetched.
 */
async function killPlexTranscode(hlsSessionId: string | null): Promise<void> {
  if (!hlsSessionId) return;

  const plexKey = getPlexTranscodeKey(hlsSessionId);
  const clientId = getSessionClientId(hlsSessionId);
  const ratingKey = getSessionRatingKey(hlsSessionId) || null;
  const stopKey = plexKey || hlsSessionId;

  // Stop the Plex transcode FIRST, then clear the mapping.
  try {
    const res = await plexFetch(
      "/video/:/transcode/universal/stop",
      { session: stopKey },
      {
        "X-Plex-Session-Identifier": stopKey,
        "X-Plex-Client-Identifier": clientId,
      },
    );
    console.log("[Sync] Stop transcode", stopKey.substring(0, 8),
      plexKey ? "(mapped plex key)" : "(our UUID, no mapping)",
      "→", res.status);
  } catch (err) {
    console.error("[Sync] Stop transcode error:", err);
  }

  // Now clear the mapping and block segment proxy
  markTranscodeStopped(hlsSessionId);

  // Notify Plex that playback stopped so it clears per-client state.
  // Await this — if it's fire-and-forget, a new start can race ahead
  // before Plex processes the timeline update, causing 400.
  // Pass the ratingKey captured BEFORE markTranscodeStopped cleared it.
  await notifyPlexStopped(ratingKey, hlsSessionId);
}

interface RoomClient {
  ws: WebSocket;
  userId: string;
  isHost: boolean;
}

interface RoomState {
  ratingKey: string | null;
  title: string | null;
  subtitles: boolean;
  playing: boolean;
  position: number;
  updatedAt: number;
  hlsSessionId: string | null;
}

interface Room {
  clients: Set<RoomClient>;
  state: RoomState;
}

const rooms = new Map<string, Room>();
let wss: WebSocketServer | null = null;
let trackerWss: WebSocketServer | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function getOrCreateRoom(instanceId: string): Room {
  let room = rooms.get(instanceId);
  if (!room) {
    room = {
      clients: new Set(),
      state: {
        ratingKey: null,
        title: null,
        subtitles: false,
        playing: false,
        position: 0,
        updatedAt: Date.now(),
        hlsSessionId: null,
      },
    };
    rooms.set(instanceId, room);
  }
  return room;
}

function broadcast(room: Room, sender: WebSocket, msg: object): void {
  const data = JSON.stringify(msg);
  for (const client of room.clients) {
    if (client.ws !== sender && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

function sendTo(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function interpolatedPosition(state: RoomState): number {
  if (!state.playing) return state.position;
  const elapsed = (Date.now() - state.updatedAt) / 1000;
  return state.position + elapsed;
}

export function attachWebSocketServer(server: Server): void {
  wss = new WebSocketServer({ noServer: true });

  // Dedicated WSS for the P2P tracker — keeps tracker traffic isolated
  trackerWss = new WebSocketServer({ noServer: true });
  createTracker();

  trackerWss.on("connection", (ws) => {
    handleTrackerSocket(ws);
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname === "/tracker") {
      const token = url.searchParams.get("token");
      if (!token || !isValidSession(token)) {
        socket.destroy();
        return;
      }
      trackerWss!.handleUpgrade(req, socket, head, (ws) => {
        trackerWss!.emit("connection", ws, req);
      });
      return;
    }
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    // Validate session token at upgrade time (mirrors /tracker auth).
    // The join message also validates, but rejecting early avoids allocating
    // a WebSocket for unauthenticated connections.
    const wsToken = url.searchParams.get("token");
    if (!wsToken || !isValidSession(wsToken)) {
      socket.destroy();
      return;
    }
    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    let client: RoomClient | null = null;
    let roomId: string | null = null;

    let alive = true;

    const pingTimer = setInterval(() => {
      if (!alive) {
        console.log("[Sync] Terminating unresponsive WebSocket",
          client?.userId?.substring(0, 8) ?? "(unauthenticated)");
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, WS_PING_INTERVAL_MS);

    ws.on("pong", () => {
      alive = true;
    });

    ws.on("message", (raw: RawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const type = msg.type as string;

      // First message must be join
      if (type === "join") {
        const token = msg.sessionToken as string;
        const instanceId = msg.instanceId as string;
        const userId = msg.userId as string;

        if (!token || !instanceId || !userId) {
          sendTo(ws, { type: "error", message: "Missing join fields" });
          ws.close(1008, "Missing join fields");
          return;
        }

        if (!isValidSession(token)) {
          sendTo(ws, { type: "error", message: "Invalid session" });
          ws.close(1008, "Invalid session");
          return;
        }

        const instance = instanceHosts.get(instanceId);
        if (!instance) {
          sendTo(ws, { type: "error", message: "Unknown instance" });
          ws.close(1008, "Unknown instance");
          return;
        }

        const isHost = instance.hostUserId === userId;
        const room = getOrCreateRoom(instanceId);

        // Evict stale connection from the same user (e.g. browser reconnected
        // before Node processed the close event for the old socket)
        for (const existing of room.clients) {
          if (existing.userId === userId) {
            existing.isHost = false; // prevent close handler from triggering host-left logic
            room.clients.delete(existing);
            existing.ws.close(1000, "Replaced by new connection");
            break;
          }
        }

        client = { ws, userId, isHost };
        roomId = instanceId;
        room.clients.add(client);

        // If the host is (re)joining and there are other clients, clear their disconnect banner
        if (isHost && room.clients.size > 1) {
          broadcast(room, ws, { type: "host-reconnected" });
        }

        // Send current state to newly joined client
        sendTo(ws, {
          type: "state",
          ratingKey: room.state.ratingKey,
          title: room.state.title,
          subtitles: room.state.subtitles,
          playing: room.state.playing,
          position: interpolatedPosition(room.state),
          hlsSessionId: room.state.hlsSessionId,
        });

        return;
      }

      // All subsequent messages require a joined client
      if (!client || !roomId) {
        sendTo(ws, { type: "error", message: "Must join first" });
        return;
      }

      // Only host can send control messages
      if (!client.isHost) return;

      const room = rooms.get(roomId);
      if (!room) return;

      switch (type) {
        case "play": {
          room.state.ratingKey = (msg.ratingKey as string) || null;
          room.state.title = (msg.title as string) || null;
          room.state.subtitles = Boolean(msg.subtitles);
          room.state.hlsSessionId = (msg.hlsSessionId as string) || null;
          room.state.playing = true;
          room.state.position = 0;
          room.state.updatedAt = Date.now();
          broadcast(room, ws, {
            type: "play",
            ratingKey: room.state.ratingKey,
            title: room.state.title,
            subtitles: room.state.subtitles,
            hlsSessionId: room.state.hlsSessionId,
          });
          break;
        }
        case "pause": {
          room.state.playing = false;
          room.state.position = (msg.position as number) ?? room.state.position;
          room.state.updatedAt = Date.now();
          broadcast(room, ws, { type: "pause", position: room.state.position });
          break;
        }
        case "resume": {
          room.state.playing = true;
          room.state.position = (msg.position as number) ?? room.state.position;
          room.state.updatedAt = Date.now();
          broadcast(room, ws, { type: "resume", position: room.state.position });
          break;
        }
        case "seek": {
          room.state.position = (msg.position as number) ?? room.state.position;
          room.state.updatedAt = Date.now();
          broadcast(room, ws, { type: "seek", position: room.state.position });
          break;
        }
        case "stop": {
          // Capture before clearing so we can kill the exact Plex transcode
          const stoppingSessionId = room.state.hlsSessionId;
          room.state.ratingKey = null;
          room.state.title = null;
          room.state.hlsSessionId = null;
          room.state.playing = false;
          room.state.position = 0;
          room.state.updatedAt = Date.now();
          broadcast(room, ws, { type: "stop" });
          // Kill the Plex transcode server-side so it dies even if viewers
          // are still fetching segments (their hls.js takes a moment to tear down)
          if (stoppingSessionId) {
            killPlexTranscode(stoppingSessionId).catch(() => {});
          }
          break;
        }
        case "heartbeat": {
          if (!room.state.ratingKey) break;
          room.state.position = (msg.position as number) ?? room.state.position;
          room.state.playing = msg.playing !== false;
          room.state.updatedAt = Date.now();
          broadcast(room, ws, {
            type: "heartbeat",
            position: room.state.position,
            playing: room.state.playing,
          });
          break;
        }
      }
    });

    ws.on("close", () => {
      clearInterval(pingTimer);
      if (!client || !roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      room.clients.delete(client);

      if (client.isHost) {
        if (room.clients.size > 0) {
          const newHost = room.clients.values().next().value!;
          newHost.isHost = true;

          const instance = instanceHosts.get(roomId);
          if (instance) {
            instance.hostUserId = newHost.userId;
          }

          console.log("[Sync] Host left, promoting", newHost.userId.substring(0, 8), "to host");

          sendTo(newHost.ws, { type: "host-promoted" });

          for (const c of room.clients) {
            if (c !== newHost) {
              sendTo(c.ws, { type: "host-disconnected" });
              sendTo(c.ws, { type: "host-changed" });
            }
          }
        } else {
          const disconnectedSessionId = room.state.hlsSessionId;
          room.state.playing = false;
          room.state.hlsSessionId = null;
          killPlexTranscode(disconnectedSessionId).catch(() => {});
        }
      }

      if (room.clients.size === 0) {
        rooms.delete(roomId);
      }
    });
  });

  // Cleanup rooms whose instance has expired every 5 minutes
  cleanupInterval = setInterval(() => {
    for (const [instanceId, room] of rooms) {
      if (!instanceHosts.has(instanceId) && room.clients.size === 0) {
        rooms.delete(instanceId);
      }
    }
  }, 5 * 60 * 1000);
  cleanupInterval.unref();
}

export function closeWebSocketServer(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (wss) {
    for (const client of wss.clients) {
      client.close(1001, "Server shutting down");
    }
    wss.close();
    wss = null;
  }
  if (trackerWss) {
    for (const client of trackerWss.clients) {
      client.close(1001, "Server shutting down");
    }
    trackerWss.close();
    trackerWss = null;
  }
  destroyTracker();
  rooms.clear();
}
