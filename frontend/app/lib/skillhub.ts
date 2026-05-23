import { SkillHubClient } from "skillhub-sdk";
import { clientApiBaseUrl, serverApiBaseUrl } from "./backend-url";

export { clientApiBaseUrl, serverApiBaseUrl };

/** Unauthenticated client — only for endpoints that remain public. */
export const skillHub = new SkillHubClient({ baseUrl: clientApiBaseUrl() });

export function createAuthenticatedSkillHubClient(
  getAccessToken: () => Promise<string>,
): SkillHubClient {
  return new SkillHubClient({
    baseUrl: clientApiBaseUrl(),
    userAuth: { accessToken: getAccessToken },
  });
}
