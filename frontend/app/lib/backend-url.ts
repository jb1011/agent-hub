/** Backend URL for Next.js rewrites and server-side proxy routes. */
export const serverApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

/** Same-origin API prefix in the browser (avoids mixed content on HTTPS deploys). */
export function clientApiBaseUrl(): string {
  if (typeof window !== "undefined") return "/api";
  return serverApiBaseUrl;
}
