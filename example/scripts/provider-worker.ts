/**
 * Poll Skill Hub for FUNDED jobs, run the local agent /chat, submit job-finish.
 *
 * Run on the same machine as agent-poete (pm2 or loop). Requires SIGNER_WALLET_PK
 * to match the provider's signer_wallet on Skill Hub.
 */
import type { AuthorizationExpiryInput } from "../../backend/sdk/dist/index.js";
import { config } from "dotenv";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, providerClient } from "../lib/sdk-client.ts";
import { signTypedData, type Eip712TypedData } from "../lib/transactions.ts";

config({ path: new URL("../.env", import.meta.url) });

type WorkerConfig = AuthorizationExpiryInput & {
  provider_id: string;
};

const workerConfig = await readJsonConfig<WorkerConfig>("./config/start-job.json");
const { provider_id: providerId, expires_in_seconds: expiresInSeconds = 300 } = workerConfig;

if (!providerId) {
  throw new Error("start-job.json must include provider_id (API request_id, bytes32)");
}

const signedClient = providerClient(providerId);
const CHAT_URL = process.env.CHAT_URL ?? "http://127.0.0.1:3000/chat";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "10000");

function extractPrompt(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    if (typeof record.prompt === "string") return record.prompt;
    if (typeof record.uri === "string") return record.uri;
    if (typeof record.text === "string") return record.text;
  }
  return JSON.stringify(input);
}

async function callAgentChat(message: string): Promise<string> {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Agent chat ${res.status}: ${text}`);
  }
  const parsed = JSON.parse(text) as { reply?: string };
  if (typeof parsed.reply !== "string") {
    throw new Error(`Agent chat response missing reply: ${text}`);
  }
  return parsed.reply;
}

function isNoNextJobError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("next_job_not_found");
}

async function processNextJob(): Promise<boolean> {
  const authorization = await signedClient.jobs.requestStartNextJob({
    expires_in_seconds: expiresInSeconds,
  });
  const jobId = authorization.start_job_args.job_id;
  console.log(`\n[worker] Processing next job ${jobId}`);

  const provider_signature = await signTypedData(
    "StartJobAuthorization",
    authorization.typed_data as Eip712TypedData,
  );

  const started = await signedClient.jobs.startJob(jobId, {
    provider_signature,
    expires_in_seconds: expiresInSeconds,
  });

  const prompt = extractPrompt(started.input);
  console.log(`[worker] Prompt (${prompt.length} chars):`, prompt);

  const reply = await callAgentChat(prompt);
  console.log(`[worker] Reply (${reply.length} chars)`);

  const finished = await signedClient.jobs.finishJob(jobId, { output: reply });
  console.log(`[worker] Job finished, status should be SUBMITTED:`, finished.status);
  return true;
}

async function pollOnce() {
  let processed = 0;
  for (;;) {
    try {
      const didProcess = await processNextJob();
      if (!didProcess) break;
      processed += 1;
    } catch (err) {
      if (isNoNextJobError(err)) break;
      console.error("[worker] Failed processing next job:", err);
      break;
    }
  }
  if (processed === 0) {
    console.log(`[worker] No startable FUNDED jobs for provider ${providerId}`);
  }
}

console.log(`Skill Hub worker → ${API_URL}`);
console.log(`Provider id (start-job.json): ${providerId}`);
console.log(`Agent chat: ${CHAT_URL}`);
console.log(`Poll every ${POLL_INTERVAL_MS}ms`);

const once = process.argv.includes("--once");
if (once) {
  await pollOnce();
} else {
  for (;;) {
    await pollOnce();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
