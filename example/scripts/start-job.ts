import type { AuthorizationExpiryInput, FinishJobInput, Job } from "../../backend/sdk/dist/index.js";
import type { Eip712TypedData } from "../lib/transactions.ts";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, providerClient, userClient } from "../lib/sdk-client.ts";
import { signTypedData } from "../lib/transactions.ts";

function extractPromptFromInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    if (typeof record.prompt === "string") return record.prompt;
    if (typeof record.text === "string") return record.text;
    if (typeof record.uri === "string") return record.uri;
  }
  return JSON.stringify(input);
}

function logJob(label: string, job: Job) {
  const prompt = extractPromptFromInput(job.input);
  console.log(`\n[skillhub] ${label}`);
  console.log(JSON.stringify(job, null, 2));
  console.log(`[skillhub] ${label} → input:`, job.input);
  console.log(`[skillhub] ${label} → extracted prompt:`, prompt);
  console.log(`[skillhub] ${label} → prompt length:`, prompt.length);
}

type StartJobConfig = AuthorizationExpiryInput & {
  provider_id?: string;
  job_id?: string;
};

const config = await readJsonConfig<StartJobConfig>("./config/start-job.json");
const { provider_id, job_id, ...authorizationExpiry } = config;

console.log(`Skill Hub API: ${API_URL}`);

let providerId = provider_id;
let expectedJobId = job_id;

if (!providerId && job_id) {
  console.log(`Job id from config: ${job_id}`);
  const signedUserClient = await userClient();
  const jobBefore = await signedUserClient.jobs.get(job_id);
  logJob("jobs.get (before start)", jobBefore);
  providerId = jobBefore.provider.request_id;
  expectedJobId = jobBefore.job_id ?? jobBefore.request_id;
}

if (!providerId) {
  throw new Error("start-job config must include provider_id, or job_id to derive provider_id");
}

console.log(`Provider id for start-next-job-request: ${providerId}`);
const signedClient = providerClient(providerId);

console.log("Requesting start authorization for next provider job...");

const authorization = await signedClient.jobs.requestStartNextJob(authorizationExpiry);
const selectedJobId = authorization.start_job_args.job_id;

if (expectedJobId && expectedJobId !== selectedJobId) {
  throw new Error(
    `Backend selected job_id ${selectedJobId}, but config expected ${expectedJobId}. ` +
    "Remove job_id from start-job.json to process the next provider job."
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
const startedPrompt = extractPromptFromInput(started.input);
console.log("[skillhub] startJob → input:", started.input);
console.log("[skillhub] startJob → extracted prompt:", startedPrompt);
console.log("[skillhub] startJob → prompt length:", startedPrompt.length);

const result = 1 + 1;
const finishInput: FinishJobInput = {
  output: {
    text: `1 + 1 = ${result}`,
  }
};

console.log("\nComputed output:");
console.log(JSON.stringify(finishInput.output, null, 2));

const finished = await signedClient.jobs.finishJob(selectedJobId, finishInput);

console.log("\nJob finished:");
console.log(JSON.stringify(finished, null, 2));
