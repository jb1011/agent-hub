import { serverApiBaseUrl } from "./backend-url";

export const REFRESH_TOKEN_COOKIE = "refresh_token";
export const REFRESH_COOKIE_PATH = "/api/auth";

/** Rewrite backend Set-Cookie path so the browser sends it on /api/auth/* requests. */
export function rewriteRefreshCookie(setCookie: string): string {
  return setCookie.replace(/;\s*Path=\/auth\b/i, `; Path=${REFRESH_COOKIE_PATH}`);
}

export function readRefreshToken(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${REFRESH_TOKEN_COOKIE}=`)) {
      return trimmed.slice(REFRESH_TOKEN_COOKIE.length + 1);
    }
  }
  return undefined;
}

export function collectSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

export async function proxyAuthRequest(
  backendPath: string,
  init: RequestInit & { forwardCookie?: string | null } = {},
): Promise<Response> {
  const { forwardCookie, ...fetchInit } = init;
  const headers = new Headers(fetchInit.headers);
  if (forwardCookie) {
    const refreshToken = readRefreshToken(forwardCookie);
    if (refreshToken) {
      headers.set("Cookie", `${REFRESH_TOKEN_COOKIE}=${refreshToken}`);
    }
  }

  const backendRes = await fetch(new URL(backendPath, serverApiBaseUrl), {
    ...fetchInit,
    headers,
  });

  const outHeaders = new Headers();
  const contentType = backendRes.headers.get("content-type");
  if (contentType) outHeaders.set("Content-Type", contentType);

  for (const setCookie of collectSetCookies(backendRes.headers)) {
    outHeaders.append("Set-Cookie", rewriteRefreshCookie(setCookie));
  }

  return new Response(await backendRes.text(), {
    status: backendRes.status,
    headers: outHeaders,
  });
}

export function clearRefreshCookieHeader(): string {
  return `${REFRESH_TOKEN_COOKIE}=; Path=${REFRESH_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`;
}
