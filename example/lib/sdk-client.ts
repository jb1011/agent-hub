import { config } from "dotenv";
import { SkillHubClient } from "../../backend/sdk/dist/index.js";

config({ path: new URL("../.env", import.meta.url) });

export const API_URL = process.env.API_URL ?? "http://localhost:3000";

export const client = new SkillHubClient({ baseUrl: API_URL });
