import type { AuthorizationExpiryInput, FinishJobInput } from "../../backend/sdk/dist/index.js";
import type { Eip712TypedData } from "../lib/transactions.ts";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, client } from "../lib/sdk-client.ts";
import { signTypedData } from "../lib/transactions.ts";

type StartJobConfig = AuthorizationExpiryInput & {
  job_id: string;
};

const config = await readJsonConfig<StartJobConfig>("./config/start-job.json");
const { job_id, ...authorizationExpiry } = config;

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Requesting start authorization for job ${job_id}...`);

const authorization = await client.jobs.requestStartAuthorization(job_id, authorizationExpiry);

console.log("\nStart authorization typed data:");
console.log(JSON.stringify(authorization, null, 2));

const provider_signature = await signTypedData(
  "StartJobAuthorization",
  authorization.typed_data as Eip712TypedData
);

console.log("\nProvider signature:");
console.log(provider_signature);

const started = await client.jobs.startJob(job_id, {
  provider_signature,
  ...authorizationExpiry,
});

console.log("\nJob started:");
console.log(JSON.stringify(started, null, 2));

const result = 1 + 1;
const finishInput: FinishJobInput = {
  output: {
    text: `1 + 1 = ${result}`,
  }
};

console.log("\nComputed output:");
console.log(JSON.stringify(finishInput.output, null, 2));

const finished = await client.jobs.finishJob(job_id, finishInput);

console.log("\nJob finished:");
console.log(JSON.stringify(finished, null, 2));
