// Thin client for the api-gateway's { success, data | error, traceId }
// envelope. The access token lives only in memory (never localStorage);
// the httpOnly refresh cookie restores it, once, when it expires.

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: string[] = [],
    readonly traceId: string | null = null,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
const listeners = new Set<(token: string | null) => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((l) => l(token));
}

export function onTokenChange(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: string[] };
  traceId?: string | null;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success) {
    throw new ApiError(
      body?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      body?.error?.code ?? 'ERROR',
      body?.error?.details ?? [],
      body?.traceId ?? null,
    );
  }
  return body.data as T;
}

// Single-flight: concurrent 401s share one refresh round-trip.
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((res) => parse<{ accessToken: string }>(res))
    .then((data) => {
      setAccessToken(data.accessToken);
      return data.accessToken;
    })
    .catch(() => {
      setAccessToken(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  const send = (token: string | null): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

  let res = await send(accessToken);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const token = await refreshAccessToken();
    if (token) res = await send(token);
  }
  return parse<T>(res);
}

// Authenticated file download (CSV / markdown exports).
export async function download(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new ApiError('Download failed', res.status, 'ERROR');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const fetcher = <T>(path: string): Promise<T> => api<T>(path);
