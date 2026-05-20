import type {
  CreateProviderInput,
} from "../../backend/sdk/dist/index.js";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, client } from "../lib/sdk-client.ts";
import { sendPreparedTransaction } from "../lib/transactions.ts";

const provider = await readJsonConfig<CreateProviderInput>("./config/provider.json");

console.log(`Skill Hub API: ${API_URL}`);
console.log("Registering provider payload:");
console.log(JSON.stringify(provider, null, 2));

const transaction = await client.providers.create(provider);

console.log("\nPrepared registerProvider transaction:");
console.log(JSON.stringify(transaction, null, 2));

await sendPreparedTransaction("registerProvider", transaction, provider.owner_wallet);
