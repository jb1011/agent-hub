import { config } from "dotenv";
import { SkillHubClient } from "../../backend/sdk/dist/index.js";
import { signerWallet } from "./transactions.ts";

config({ path: new URL("../.env", import.meta.url) });

export const API_URL = process.env.API_URL ?? "http://localhost:3000";

export const client = new SkillHubClient({ baseUrl: API_URL });

export function providerClient(providerId: string): SkillHubClient {
  const signer = signerWallet();

  return new SkillHubClient({
    baseUrl: API_URL,
    providerAuth: {
      providerId,
      providerAddress: signer.address,
      signMessage: (message) => signer.signMessage(message),
    },
  });
}
