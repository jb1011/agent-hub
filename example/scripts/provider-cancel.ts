import type { ProviderCancelInput } from "../../backend/sdk/dist/index.js";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, providerClient } from "../lib/sdk-client.ts";

type ProviderCancelConfig = ProviderCancelInput & {
  provider_id: string;
  job_id: string;
};

const config = await readJsonConfig<ProviderCancelConfig>("./config/provider-cancel.json");
const jobId = process.argv[2] ?? config.job_id;
const providerId = process.argv[3] ?? config.provider_id;
const { provider_id, job_id, ...cancelInput } = config;

if (!jobId) {
  throw new Error("Missing job id. Set config/provider-cancel.json job_id or pass it as the first argument.");
}

if (!providerId) {
  throw new Error("Missing provider id. Set config/provider-cancel.json provider_id or pass it as the second argument.");
}

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Cancelling running job ${jobId} as provider ${providerId}...`);

const signedClient = providerClient(providerId);
const cancelled = await signedClient.jobs.providerCancel(jobId, cancelInput);

console.log("\nJob cancelled and refunded:");
console.log(JSON.stringify(cancelled, null, 2));
