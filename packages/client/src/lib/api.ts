let sessionToken: string | null = null;

export function setSessionToken(token: string): void {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

const BASE = "";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;
  return headers;
}

export async function apiGet<T = unknown>(
  path: string,
  options?: { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: authHeaders(),
    signal: options?.signal,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export async function apiPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
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
  options?: { signal?: AbortSignal },
): Promise<{ items: PlexItem[] }> {
  return apiGet(`/api/plex/sections/${encodeURIComponent(sectionId)}/all`, options);
}

export function searchPlex(query: string): Promise<{ items: PlexItem[] }> {
  return apiGet(`/api/plex/search?q=${encodeURIComponent(query)}`);
}

export function fetchMeta(ratingKey: string): Promise<PlexMeta> {
  return apiGet(`/api/plex/meta/${encodeURIComponent(ratingKey)}`);
}

export function hlsMasterUrl(ratingKey: string, sessionId: string): string {
  return `/api/plex/hls/${encodeURIComponent(ratingKey)}/${encodeURIComponent(sessionId)}/master.m3u8`;
}

export function pingSession(sessionId: string): Promise<void> {
  return apiGet(`/api/plex/hls/ping/${encodeURIComponent(sessionId)}`);
}

export function stopSession(sessionId: string): Promise<void> {
  return apiDelete(`/api/plex/hls/session/${encodeURIComponent(sessionId)}`);
}
