/**
 * Poll Skill Hub for FUNDED jobs, run the local agent /chat, submit job-finish.
 *
 * Run on the same machine as agent-poete (pm2 or loop). Requires SIGNER_WALLET_PK
 * to match the provider's signer_wallet on Skill Hub.
 */
import type { Job } from "../../backend/sdk/dist/index.js";
import { config } from "dotenv";
import { client, API_URL } from "../lib/sdk-client.ts";
import { env, signTypedData, type Eip712TypedData } from "../lib/transactions.ts";

config({ path: new URL("../.env", import.meta.url) });

const PROVIDER_REQUEST_ID = env("PROVIDER_REQUEST_ID");
const CHAT_URL = process.env.CHAT_URL ?? "http://127.0.0.1:3000/chat";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "10_000");
const AUTH_EXPIRES_IN_SECONDS = Number(process.env.AUTH_EXPIRES_IN_SECONDS ?? "300");

function extractPrompt(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
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

async function processJob(job: Job) {
  const jobId = job.request_id;
  console.log(`\n[worker] Processing job ${jobId} (on-chain job_id=${job.job_id})`);

  const authorization = await client.jobs.requestStartAuthorization(jobId, {
    expires_in_seconds: AUTH_EXPIRES_IN_SECONDS,
  });

  const provider_signature = await signTypedData(
    "StartJobAuthorization",
    authorization.typed_data as Eip712TypedData,
  );

  const started = await client.jobs.startJob(jobId, {
    provider_signature,
    expires_in_seconds: AUTH_EXPIRES_IN_SECONDS,
  });

  const prompt = extractPrompt(started.input);
  console.log(`[worker] Prompt (${prompt.length} chars):`, prompt);

  const reply = await callAgentChat(prompt);
  console.log(`[worker] Reply (${reply.length} chars)`);

  const finished = await client.jobs.finishJob(jobId, { output: reply });
  console.log(`[worker] Job finished, status should be SUBMITTED:`, finished.status);
}

async function pollOnce() {
  const funded = await client.jobs.list({
    status: "FUNDED",
    provider_request_id: PROVIDER_REQUEST_ID,
  });
  if (funded.length === 0) {
    console.log(`[worker] No FUNDED jobs for ${PROVIDER_REQUEST_ID}`);
    return;
  }
  for (const job of funded) {
    try {
      await processJob(job);
    } catch (err) {
      console.error(`[worker] Failed job ${job.request_id}:`, err);
    }
  }
}

console.log(`Skill Hub worker → ${API_URL}`);
console.log(`Provider request_id: ${PROVIDER_REQUEST_ID}`);
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
