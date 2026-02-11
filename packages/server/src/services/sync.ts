import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "http";
import { isValidSession } from "../middleware/auth.js";
import { instanceHosts } from "../routes/discord.js";

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
}

interface Room {
  clients: Set<RoomClient>;
  state: RoomState;
}

const rooms = new Map<string, Room>();
let wss: WebSocketServer | null = null;
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

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws") {
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

        client = { ws, userId, isHost };
        roomId = instanceId;
        room.clients.add(client);

        // Send current state to newly joined client
        sendTo(ws, {
          type: "state",
          ratingKey: room.state.ratingKey,
          title: room.state.title,
          subtitles: room.state.subtitles,
          playing: room.state.playing,
          position: interpolatedPosition(room.state),
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
          room.state.playing = true;
          room.state.position = 0;
          room.state.updatedAt = Date.now();
          broadcast(room, ws, {
            type: "play",
            ratingKey: room.state.ratingKey,
            title: room.state.title,
            subtitles: room.state.subtitles,
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
          room.state.ratingKey = null;
          room.state.title = null;
          room.state.playing = false;
          room.state.position = 0;
          room.state.updatedAt = Date.now();
          broadcast(room, ws, { type: "stop" });
          break;
        }
        case "heartbeat": {
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
      if (!client || !roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      room.clients.delete(client);

      if (client.isHost) {
        broadcast(room, ws, { type: "host-disconnected" });
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
  rooms.clear();
}
