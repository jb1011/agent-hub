import { SkillHubClient } from "skillhub-sdk";

/** Backend URL for Next.js rewrites (server-side proxy target). May be http. */
export const serverApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

/** API base for fetch calls: same-origin /api in the browser to avoid mixed content on HTTPS deploys. */
function clientApiBaseUrl(): string {
  if (typeof window !== "undefined") return "/api";
  return serverApiBaseUrl;
}

export const skillHub = new SkillHubClient({ baseUrl: clientApiBaseUrl() });
