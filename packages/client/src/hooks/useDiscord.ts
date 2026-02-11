import { useState, useEffect, useRef } from "react";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { apiPost } from "../lib/api";

interface DiscordState {
  isReady: boolean;
  isHost: boolean;
  userId: string | null;
  username: string | null;
  error: string | null;
}

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string;

export function useDiscord(): DiscordState {
  const [state, setState] = useState<DiscordState>({
    isReady: false,
    isHost: false,
    userId: null,
    username: null,
    error: null,
  });
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const init = async () => {
      try {
        const sdk = new DiscordSDK(CLIENT_ID);
        await sdk.ready();

        const { code } = await sdk.commands.authorize({
          client_id: CLIENT_ID,
          response_type: "code",
          state: "",
          prompt: "none",
          scope: ["identify", "guilds", "rpc.voice.read"],
        });

        const { access_token } = await apiPost<{ access_token: string }>(
          "/api/token",
          { code },
        );

        const auth = await sdk.commands.authenticate({ access_token });
        const user = auth.user;

        const { isHost } = await apiPost<{ isHost: boolean; hostId: string }>(
          "/api/register",
          {
            instanceId: sdk.instanceId,
            userId: user.id,
          },
        );

        setState({
          isReady: true,
          isHost,
          userId: user.id,
          username: user.username,
          error: null,
        });
      } catch (err) {
        console.error("Discord SDK init failed:", err);
        const message = err instanceof Error ? err.message : "Failed to connect to Discord";
        setState((prev) => ({
          ...prev,
          error: message,
        }));
      }
    };

    init();
  }, []);

  return state;
}
