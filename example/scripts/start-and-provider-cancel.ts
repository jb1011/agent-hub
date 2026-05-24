import type { ProviderCancelInput } from "../../backend/sdk/dist/index.js";
import type { Eip712TypedData } from "../lib/transactions.ts";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, providerClient } from "../lib/sdk-client.ts";
import { signTypedData } from "../lib/transactions.ts";

type StartAndCancelConfig = ProviderCancelInput & {
  provider_id: string;
  job_id: string;
};

const config = await readJsonConfig<StartAndCancelConfig>("./config/provider-cancel.json");
const jobId = process.argv[2] ?? config.job_id;
const providerId = process.argv[3] ?? config.provider_id;
const { provider_id, job_id, error_message, ...authorizationExpiry } = config;

if (!jobId) {
  throw new Error("Missing job id. Set config/provider-cancel.json job_id or pass it as the first argument.");
}

if (!providerId) {
  throw new Error("Missing provider id. Set config/provider-cancel.json provider_id or pass it as the second argument.");
}

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Starting job ${jobId} as provider ${providerId}, then cancelling it...`);

const signedClient = providerClient(providerId);

console.log("\nRequesting start authorization for next provider job...");
const authorization = await signedClient.jobs.requestStartNextJob(authorizationExpiry);
const selectedJobId = authorization.start_job_args.job_id;

if (jobId !== selectedJobId) {
  throw new Error(
    `Backend selected job_id ${selectedJobId}, but script expected ${jobId}. ` +
    "The backend starts the next FUNDED job for this provider."
  );
}

console.log("\nStart authorization typed data:");
console.log(JSON.stringify(authorization, null, 2));

const provider_signature = await signTypedData(
  "StartJobAuthorization",
  authorization.typed_data as Eip712TypedData
);

console.log("\nProvider signature:");
console.log(provider_signature);

const started = await signedClient.jobs.startJob(selectedJobId, {
  provider_signature,
  ...authorizationExpiry,
});

console.log("\nJob started:");
console.log(JSON.stringify(started, null, 2));

const cancelInput: ProviderCancelInput = {
  ...authorizationExpiry,
  ...(error_message ? { error_message } : {}),
};

console.log("\nCancelling started job...");
const cancelled = await signedClient.jobs.providerCancel(selectedJobId, cancelInput);

console.log("\nJob cancelled and refunded:");
console.log(JSON.stringify(cancelled, null, 2));
