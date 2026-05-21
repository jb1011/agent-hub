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

/** Minimal EIP-712 sign — use ethers Wallet in production (see provider-worker.ts). */
async function signStartJob(typedData, privateKey) {
  const { Wallet } = await import("ethers");
  const wallet = new Wallet(privateKey);
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

  const auth = await skillhubFetch(
    `/jobs/${encodeURIComponent(jobRequestId)}/start-authorization-request`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expires_in_seconds: 300 }),
    },
  );

  const provider_signature = await signStartJob(auth.typed_data, SIGNER_WALLET_PK);

  await skillhubFetch(`/jobs/${encodeURIComponent(jobRequestId)}/start-job`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_signature, expires_in_seconds: 300 }),
  });

  const reply = await runChat(message);

  await skillhubFetch(`/jobs/${encodeURIComponent(jobRequestId)}/job-finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ output: reply, expires_in_seconds: 3600 }),
  });

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
