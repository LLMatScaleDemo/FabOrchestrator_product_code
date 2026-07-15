"use client";

/**
 * Client-side auth for the Modeling Agent wizard fetches.
 *
 * The ported cmf-loader wizard called `fetch()` relying on a NextAuth cookie.
 * The fab app authenticates with a bearer token (localStorage), so wizard
 * requests must carry the Authorization header. `cmfFetch` injects it.
 */
const AUTH_TOKEN_KEY = "llmatscale_auth_token";

export function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function cmfFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
}
