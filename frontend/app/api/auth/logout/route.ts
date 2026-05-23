import {
  clearRefreshCookieHeader,
  proxyAuthRequest,
} from "../../../lib/auth-proxy";

export async function POST(req: Request) {
  const res = await proxyAuthRequest("/auth/logout", {
    method: "POST",
    forwardCookie: req.headers.get("cookie"),
  });

  const headers = new Headers(res.headers);
  headers.append("Set-Cookie", clearRefreshCookieHeader());
  return new Response(await res.text(), { status: res.status, headers });
}
