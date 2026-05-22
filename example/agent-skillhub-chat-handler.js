/**
 * Drop-in handler for agent-poet index.js POST /chat when Skill Hub sends a job.
 *
 * Env on the agent VPS:
 *   SKILLHUB_API_URL=http://159.223.137.183:3000
 *   SIGNER_WALLET_PK=0x...   (provider signer_wallet)
 *
 * Body from Skill Hub UI (via Next proxy):
 *   { "message": "...", "job_request_id": "0x...", "skillhub_api_url": "..." }
 *
 * Plain chat (no job): { "message": "..." }
 */

const SKILLHUB_API_URL = process.env.SKILLHUB_API_URL?.trim();
const SIGNER_WALLET_PK = process.env.SIGNER_WALLET_PK?.trim();

async function skillhubFetch(path, init) {
  const base = SKILLHUB_API_URL?.replace(/\/$/, "");
  if (!base) throw new Error("SKILLHUB_API_URL not set");
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    throw new Error(data.error ?? text ?? `Skill Hub ${res.status}`);
  }
  return data;
}

function normalizePrivateKey(privateKey) {
  return privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
}

async function buildProviderAuthHeaders(path, body, providerId, privateKey) {
  const { getAddress, keccak256, toUtf8Bytes, Wallet } = await import("ethers");
  const wallet = new Wallet(normalizePrivateKey(privateKey));
  const providerAddress = getAddress(wallet.address);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const queryStart = path.indexOf("?");
  const rawQuery = queryStart === -1 ? "" : path.slice(queryStart + 1);
  const bodyHash = keccak256(toUtf8Bytes(body ?? ""));
  const queryHash = keccak256(toUtf8Bytes(rawQuery));
  const message = [
    "SkillHub Provider Request",
    `providerId:${providerId}`,
    `providerAddress:${providerAddress}`,
    `timestamp:${timestamp}`,
    `nonce:${nonce}`,
    `bodyHash:${bodyHash}`,
    `queryHash:${queryHash}`,
  ].join("\n");

  return {
    "X-Provider-Id": providerId,
    "X-Provider-Address": providerAddress,
    "X-Timestamp": timestamp,
    "X-Body-Hash": bodyHash,
    "X-Signature": await wallet.signMessage(message),
    "X-Nonce": nonce,
    "X-Query-Hash": queryHash,
  };
}

async function skillhubProviderFetch(path, body, providerId) {
  const encodedBody = JSON.stringify(body);
  const authHeaders = await buildProviderAuthHeaders(path, encodedBody, providerId, SIGNER_WALLET_PK);
  return skillhubFetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: encodedBody,
  });
}

/** Minimal EIP-712 sign — use ethers Wallet in production (see provider-worker.ts). */
async function signStartJob(typedData, privateKey) {
  const { Wallet } = await import("ethers");
  const wallet = new Wallet(normalizePrivateKey(privateKey));
  return wallet.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.value,
  );
}

async function runSkillHubJob(jobRequestId, message, runChat) {
  if (!SIGNER_WALLET_PK) {
    throw new Error("SIGNER_WALLET_PK not set — cannot start Skill Hub job");
  }

  const encodedJobId = encodeURIComponent(jobRequestId);
  const job = await skillhubFetch(`/jobs/${encodedJobId}`);
  const providerId = job.provider?.request_id;
  if (!providerId) {
    throw new Error(`Skill Hub job ${jobRequestId} response missing provider.request_id`);
  }
  if (!job.job_id) {
    throw new Error(`Skill Hub job ${jobRequestId} is not funded on-chain yet`);
  }

  const auth = await skillhubProviderFetch(
    "/jobs/start-next-job-request",
    { expires_in_seconds: 300 },
    providerId,
  );
  const selectedJobId = auth.start_job_args?.job_id;
  if (!selectedJobId) {
    throw new Error("Skill Hub start-next-job-request response missing start_job_args.job_id");
  }
  if (String(job.job_id) !== String(selectedJobId)) {
    throw new Error(
      `Skill Hub selected next job ${selectedJobId}, but chat requested ${job.job_id}`
    );
  }

  const provider_signature = await signStartJob(auth.typed_data, SIGNER_WALLET_PK);

  await skillhubProviderFetch(
    `/jobs/${encodeURIComponent(selectedJobId)}/start-job`,
    { provider_signature, expires_in_seconds: 300 },
    providerId,
  );

  const reply = await runChat(message);

  await skillhubProviderFetch(
    `/jobs/${encodeURIComponent(selectedJobId)}/job-finish`,
    { output: reply, expires_in_seconds: 3600 },
    providerId,
  );

  return reply;
}

/**
 * Wrap your existing /chat handler:
 *
 *   app.post("/chat", async (req, res) => {
 *     try {
 *       const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
 *       const message = body?.message;
 *       if (!message || typeof message !== "string") {
 *         return res.status(400).json({ error: "message required" });
 *       }
 *       const reply = body.job_request_id
 *         ? await handleChatWithSkillHub(body, () => yourExistingPoetCall(message))
 *         : await yourExistingPoetCall(message);
 *       res.json({ reply });
 *     } catch (err) {
 *       res.status(500).json({ error: String(err.message ?? err) });
 *     }
 *   });
 */
async function handleChatWithSkillHub(body, runChat) {
  const jobId = body.job_request_id;
  if (body.skillhub_api_url && SKILLHUB_API_URL !== body.skillhub_api_url.replace(/\/$/, "")) {
    console.warn("[skillhub] skillhub_api_url mismatch; using SKILLHUB_API_URL env");
  }
  return runSkillHubJob(jobId, body.message, runChat);
}

module.exports = { handleChatWithSkillHub, runSkillHubJob };
