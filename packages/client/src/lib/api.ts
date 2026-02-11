const BASE = "";

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export async function apiPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
}

export interface PlexItem {
  ratingKey: string;
  title: string;
  year?: number;
  type: string;
  thumb: string | null;
}

export interface PlexSection {
  id: string;
  title: string;
  type: string;
}

export interface PlexMeta {
  ratingKey: string;
  title: string;
  year?: number;
  summary?: string;
  duration?: number;
  thumb: string | null;
  art: string | null;
  genres: string[];
  type: string;
}

export function fetchSections(): Promise<{ sections: PlexSection[] }> {
  return apiGet("/api/plex/sections");
}

export function fetchSectionItems(
  sectionId: string,
): Promise<{ items: PlexItem[] }> {
  return apiGet(`/api/plex/sections/${sectionId}/all`);
}

export function searchPlex(query: string): Promise<{ items: PlexItem[] }> {
  return apiGet(`/api/plex/search?q=${encodeURIComponent(query)}`);
}

export function fetchMeta(ratingKey: string): Promise<PlexMeta> {
  return apiGet(`/api/plex/meta/${ratingKey}`);
}

export function hlsMasterUrl(ratingKey: string): string {
  return `/api/plex/hls/${ratingKey}/master.m3u8`;
}

export function pingSession(sessionId: string): Promise<void> {
  return apiGet(`/api/plex/hls/ping/${sessionId}`);
}

export function stopSession(sessionId: string): Promise<void> {
  return apiDelete(`/api/plex/hls/session/${sessionId}`);
}
