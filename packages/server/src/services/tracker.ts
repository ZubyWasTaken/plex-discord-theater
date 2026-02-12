import TrackerServer from "bittorrent-tracker/server";
import type { WebSocket } from "ws";

let tracker: InstanceType<typeof TrackerServer> | null = null;

/**
 * Create a bittorrent-tracker Server with all built-in transports disabled.
 * We pipe WebSocket connections to it manually via `onWebSocketConnection`.
 */
export function createTracker(): void {
  tracker = new TrackerServer({
    http: false,
    udp: false,
    ws: false,
    trustProxy: true,
  });

  tracker.on("error", (err: Error) => {
    console.error("[Tracker] error:", err.message);
  });

  tracker.on("warning", (err: Error) => {
    console.warn("[Tracker] warning:", err.message);
  });

  console.log("[Tracker] P2P signaling tracker ready");
}

/**
 * Hand an already-upgraded WebSocket to the tracker for signaling.
 */
export function handleTrackerSocket(ws: WebSocket): void {
  if (!tracker) {
    console.error("[Tracker] not initialized, closing socket");
    ws.close(1011, "Tracker not ready");
    return;
  }
  tracker.onWebSocketConnection(ws as any);
}

export function destroyTracker(): void {
  if (tracker) {
    tracker.close();
    tracker = null;
  }
}
