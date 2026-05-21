import type { FastifyBaseLogger } from "fastify";

/** User-facing prompt extracted from stored job.input (for provider logs). */
export function extractPromptFromJobInput(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    if (typeof record.uri === "string") return record.uri;
    if (typeof record.text === "string") return record.text;
  }
  return JSON.stringify(input);
}

type JobLogFields = {
  request_id: string;
  job_id: string | null;
  status: string;
  provider_request_id: string;
  input: unknown;
  input_hash: string | null;
};

export function logProviderJobPayload(
  logger: FastifyBaseLogger,
  event: "jobs_list" | "jobs_get" | "start_job_response",
  job: JobLogFields,
  extra?: Record<string, unknown>
) {
  const extracted_prompt = extractPromptFromJobInput(job.input);
  logger.info(
    {
      event,
      request_id: job.request_id,
      job_id: job.job_id,
      status: job.status,
      provider_request_id: job.provider_request_id,
      input: job.input,
      input_hash: job.input_hash,
      extracted_prompt,
      extracted_prompt_length: extracted_prompt?.length ?? 0,
      ...extra,
    },
    "provider job payload"
  );
}
