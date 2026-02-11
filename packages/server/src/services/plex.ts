/**
 * Plex API client. All requests are authenticated server-side.
 */

const PLEX_HEADERS = {
  Accept: "application/json",
  "X-Plex-Client-Identifier": "plex-discord-theater",
  "X-Plex-Product": "Plex Discord Theater",
  "X-Plex-Version": "1.0.0",
};

export function plexUrl(path: string, params?: Record<string, string>): string {
  const base = process.env.PLEX_URL!.replace(/\/$/, "");
  // Use string concatenation to avoid URL constructor mishandling colon-containing Plex paths
  const url = new URL(`${base}${path.startsWith("/") ? "" : "/"}${path}`);
  url.searchParams.set("X-Plex-Token", process.env.PLEX_TOKEN!);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export async function plexFetch(
  path: string,
  params?: Record<string, string>,
): Promise<Response> {
  return fetch(plexUrl(path, params), { headers: PLEX_HEADERS });
}

export async function plexJSON<T = unknown>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const res = await plexFetch(path, params);
  if (!res.ok) throw new Error(`Plex API error: ${res.status}`);
  return res.json() as Promise<T>;
}
