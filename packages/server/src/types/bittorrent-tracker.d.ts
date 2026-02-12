declare module "bittorrent-tracker/server" {
  import { EventEmitter } from "events";

  interface TrackerServerOptions {
    http?: boolean;
    udp?: boolean;
    ws?: boolean;
    trustProxy?: boolean;
    interval?: number;
    stats?: boolean;
    filter?: (infoHash: string, params: unknown, cb: (err: Error | null) => void) => void;
  }

  class TrackerServer extends EventEmitter {
    constructor(opts?: TrackerServerOptions);
    onWebSocketConnection(socket: unknown, opts?: { trustProxy?: boolean }): void;
    close(cb?: () => void): void;
    listening: boolean;
    destroyed: boolean;
  }

  export default TrackerServer;
}
