import { SkillHubClient } from "skillhub-sdk";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export const skillHub = new SkillHubClient({ baseUrl: API_BASE_URL });
