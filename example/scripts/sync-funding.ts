import type { SyncJobFundingInput } from "../../backend/sdk/dist/index.js";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, userClient } from "../lib/sdk-client.ts";

type SyncFundingConfig = SyncJobFundingInput & {
  job_id: string;
};

const config = await readJsonConfig<SyncFundingConfig>("./config/sync-funding.json");
const jobId = process.argv[2] ?? config.job_id;
const txHash = process.argv[3] ?? config.tx_hash;

if (!jobId) {
  throw new Error("Missing job id. Set config/sync-funding.json job_id or pass it as the first argument.");
}

if (!txHash) {
  throw new Error("Missing tx hash. Set config/sync-funding.json tx_hash or pass it as the second argument.");
}

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Syncing funding for job ${jobId} from tx ${txHash}...`);

const signedUserClient = await userClient();
const synced = await signedUserClient.jobs.syncFunding(jobId, {
  tx_hash: txHash,
});

console.log("\nJob funding synced:");
console.log(JSON.stringify(synced, null, 2));
