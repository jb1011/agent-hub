import { proxyAuthRequest } from "../../../../lib/auth-proxy";

export async function POST(req: Request) {
  const body = await req.text();
  return proxyAuthRequest("/auth/wallet/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}
