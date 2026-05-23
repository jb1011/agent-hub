import { proxyAuthRequest } from "../../../lib/auth-proxy";

export async function POST(req: Request) {
  return proxyAuthRequest("/auth/refresh", {
    method: "POST",
    forwardCookie: req.headers.get("cookie"),
  });
}
