import type { CreateServiceInput } from "../../backend/sdk/dist/index.js";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, client } from "../lib/sdk-client.ts";
import { sendPreparedTransaction } from "../lib/transactions.ts";

const service = await readJsonConfig<CreateServiceInput>("./config/service.json");

console.log(`Skill Hub API: ${API_URL}`);
console.log("Registering service payload:");
console.log(JSON.stringify(service, null, 2));

const transaction = await client.services.create(service);

console.log("\nPrepared registerService transaction:");
console.log(JSON.stringify(transaction, null, 2));

await sendPreparedTransaction("registerService", transaction, {
  expectedSigner: transaction.from,
});
