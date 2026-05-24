import { config } from "dotenv";
import { Wallet, type TypedDataDomain, type TypedDataField } from "ethers";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillHubClient, type StartJobInput } from "../../backend/sdk/dist/index.js";

config();
config({ path: new URL("../.env", import.meta.url) });

type DetectorOptions = {
  port?: number | string;
  chatUrl?: string;
};

type StartJobTypedData = {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  primaryType: string;
  message?: Record<string, unknown>;
  value?: Record<string, unknown>;
};

const MIN_JOB_POLL_INTERVAL_MS = 5_000;
const MAX_JOB_POLL_INTERVAL_MS = 10_000;
const DEFAULT_JOB_POLL_INTERVAL_MS = 7_000;
const DEFAULT_START_AUTH_EXPIRES_IN_SECONDS = 300;
const MAX_PROVIDER_CANCEL_ERROR_MESSAGE_LENGTH = 500;

let providerWallet: Wallet | null = null;
let chatUrl: string | null = null;
let processingProvider = false;

function envValue(names: string[], fallback?: string): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function optionalEnvValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
}

function getConfiguredProviderId(): string | null {
  const configured = optionalEnvValue(["PROVIDER_ID", "SKILLHUB_PROVIDER_ID", "provider_id"]);
  if (!configured) return null;

  const providerIds = configured
    .split(",")
    .map((providerId) => providerId.trim())
    .filter(Boolean);

  if (providerIds.length > 1) {
    throw new Error("Only one provider_id can be configured in .env for full-provider-integration.");
  }

  return providerIds[0] ?? null;
}

function numberEnv(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function getJobPollIntervalMs(): number {
  return Math.min(
    Math.max(
      numberEnv("SKILLHUB_JOB_POLL_INTERVAL_MS", DEFAULT_JOB_POLL_INTERVAL_MS),
      MIN_JOB_POLL_INTERVAL_MS,
    ),
    MAX_JOB_POLL_INTERVAL_MS,
  );
}

function getStartAuthorizationExpiresInSeconds(): number {
  return numberEnv("SKILLHUB_START_AUTH_EXPIRES_IN_SECONDS", DEFAULT_START_AUTH_EXPIRES_IN_SECONDS);
}

function getProviderWallet(): Wallet {
  if (!providerWallet) {
    throw new Error("Provider wallet is not initialized.");
  }
  return providerWallet;
}

function createSkillHubClient(providerId: string): SkillHubClient {
  const wallet = getProviderWallet();

  return new SkillHubClient({
    baseUrl: envValue(["SKILLHUB_API_BASE_URL", "API_URL"], "https://api.skill-hub.xyz"),
    providerAuth: {
      providerId,
      providerAddress: wallet.address,
      signMessage: (message) => wallet.signMessage(message),
    },
  });
}

function getChatUrl(port: number | string): string {
  return chatUrl ?? `http://127.0.0.1:${port}/chat`;
}

function extractPrompt(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "prompt" in input) {
    const prompt = (input as { prompt?: unknown }).prompt;
    if (typeof prompt === "string") return prompt;
  }
  return null;
}

function normalizeTypedData(typedData: StartJobTypedData) {
  const message = typedData.message ?? typedData.value;
  if (!message) {
    throw new Error("typed_data is missing message/value for EIP-712 signing.");
  }

  const types = { ...typedData.types };
  delete types.EIP712Domain;

  return {
    domain: typedData.domain,
    types,
    message,
  };
}

async function signStartJobTypedData(typedData: StartJobTypedData): Promise<string> {
  const { domain, types, message } = normalizeTypedData(typedData);
  return getProviderWallet().signTypedData(domain, types, message);
}

async function callChat(prompt: string, port: number | string): Promise<string> {
  const response = await fetch(getChatUrl(port), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: prompt }),
  });

  const body = await response.json().catch(() => null) as { reply?: unknown } | null;
  if (!response.ok) {
    throw new Error(`Chat failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  if (typeof body?.reply !== "string") {
    throw new Error("Chat response did not include a reply string.");
  }

  return body.reply;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

function isNoNextJobError(err: unknown): boolean {
  return /next_job_not_found|no .*job|not found|404/i.test(getErrorMessage(err));
}

function providerCancelErrorMessage(err: unknown): string {
  const prefixed = `full-provider-integration failed: ${getErrorMessage(err) || "Unknown provider processing error."}`;
  return prefixed.slice(0, MAX_PROVIDER_CANCEL_ERROR_MESSAGE_LENGTH);
}

async function cancelStartedJob(
  client: SkillHubClient,
  jobId: string,
  providerId: string,
  err: unknown,
): Promise<void> {
  try {
    console.warn(`cancelling started FUNDED ${jobId} for provider ${providerId}`);
    await client.jobs.providerCancel(jobId, {
      error_message: providerCancelErrorMessage(err),
    });
    console.warn(`cancelled started FUNDED ${jobId} for provider ${providerId}`);
  } catch (cancelErr) {
    console.error(
      `Failed to cancel started FUNDED ${jobId} for provider ${providerId}:`,
      getErrorMessage(cancelErr),
    );
  }
}

async function processNextJob(client: SkillHubClient, providerId: string, port: number | string): Promise<void> {
  let startedJobId: string | null = null;

  try {
    const authorization = await client.jobs.requestStartNextJob({
      expires_in_seconds: getStartAuthorizationExpiresInSeconds(),
    });
    const jobId = authorization.start_job_args.job_id;
    if (!jobId) {
      throw new Error("start-next-job-request did not return start_job_args.job_id.");
    }

    console.log(`processing next FUNDED ${jobId} for provider ${providerId}`);

    const providerSignature = await signStartJobTypedData(authorization.typed_data as StartJobTypedData);
    const startInput: StartJobInput = { provider_signature: providerSignature };
    if (authorization.start_job_args.expires_at) {
      startInput.expires_at = authorization.start_job_args.expires_at;
    }

    const startedJob = await client.jobs.startJob(jobId, startInput);
    startedJobId = jobId;

    const prompt = extractPrompt(startedJob.input);
    if (!prompt) {
      throw new Error(`Started job ${jobId} did not return plain text input.`);
    }

    const output = await callChat(prompt, port);
    await client.jobs.finishJob(jobId, { output });
    startedJobId = null;
    console.log(`finished FUNDED ${jobId} for provider ${providerId}`);
  } catch (err) {
    if (isNoNextJobError(err)) return;

    if (startedJobId) {
      await cancelStartedJob(client, startedJobId, providerId, err);
    }
    console.error(`Failed to process next FUNDED job for provider ${providerId}:`, getErrorMessage(err));
  }
}

async function processConfiguredProvider(providerId: string, port: number | string): Promise<void> {
  if (processingProvider) return;

  processingProvider = true;
  try {
    await processNextJob(createSkillHubClient(providerId), providerId, port);
  } finally {
    processingProvider = false;
  }
}

export async function startFundedJobDetector(options: DetectorOptions = {}): Promise<void> {
  const privateKey = optionalEnvValue(["PROVIDER_PRIVATE_KEY", "SIGNER_WALLET_PK"]);
  if (!privateKey) {
    console.warn("Skill Hub funded job detector disabled: set PROVIDER_PRIVATE_KEY or SIGNER_WALLET_PK.");
    return;
  }

  try {
    providerWallet = new Wallet(normalizePrivateKey(privateKey));
  } catch {
    console.warn("Skill Hub funded job detector disabled: PROVIDER_PRIVATE_KEY or SIGNER_WALLET_PK is invalid.");
    return;
  }

  const providerId = getConfiguredProviderId();
  if (!providerId) {
    console.warn("Skill Hub funded job detector disabled: set PROVIDER_ID or provider_id in .env.");
    return;
  }

  const port = options.port ?? process.env.PORT ?? 3000;
  chatUrl = options.chatUrl ?? optionalEnvValue(["AGENT_LOCAL_CHAT_URL", "CHAT_URL"]) ?? null;

  const pollIntervalMs = getJobPollIntervalMs();
  console.log(
    `Skill Hub next job detector enabled for provider ${providerId} signed by ${providerWallet.address} every ${pollIntervalMs}ms`,
  );

  const poll = async (): Promise<void> => {
    try {
      await processConfiguredProvider(providerId, port);
    } catch (err) {
      console.error("Skill Hub next job detector error:", getErrorMessage(err));
    }
  };

  await poll();
  setInterval(poll, pollIntervalMs);
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && path.resolve(entrypoint) === fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  startFundedJobDetector().catch((err: unknown) => {
    console.error("Failed to start Skill Hub funded job detector:", getErrorMessage(err));
  });
}
