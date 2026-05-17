import type {
  Job,
  JobWithDetails,
  CreateJobInput,
  CreateJobResult,
  TransitionJobStatusInput,
  ListJobsQuery,
} from "./types.js";

export class JobsResource {
  constructor(private readonly request: <T>(path: string, init?: RequestInit) => Promise<T>) {}

  /**
   * List jobs with optional filters.
   * GET /jobs
   */
  list(query?: ListJobsQuery): Promise<Job[]> {
    const params = new URLSearchParams();
    if (query?.request_id) params.set("request_id", query.request_id);
    if (query?.job_id) params.set("job_id", query.job_id);
    if (query?.user_wallet) params.set("user_wallet", query.user_wallet);
    if (query?.service_id) params.set("service_id", query.service_id);
    if (query?.status) params.set("status", query.status);
    const qs = params.size > 0 ? `?${params}` : "";
    return this.request<Job[]>(`/jobs${qs}`);
  }

  /**
   * Get a job by request_id or job_id (includes escrow and service info).
   * GET /jobs/:id
   */
  get(id: string): Promise<JobWithDetails> {
    return this.request<JobWithDetails>(`/jobs/${id}`);
  }

  /**
   * Create a job and generate the on-chain creation arguments.
   * POST /jobs
   */
  create(input: CreateJobInput): Promise<CreateJobResult> {
    return this.request<CreateJobResult>("/jobs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Link an on-chain job_id to an existing job request.
   * PATCH /jobs/:id/onchain-job
   */
  linkOnchainJob(id: string, jobId: string): Promise<Job> {
    return this.request<Job>(`/jobs/${id}/onchain-job`, {
      method: "PATCH",
      body: JSON.stringify({ job_id: jobId }),
    });
  }

  /**
   * Transition a job's status.
   * PATCH /jobs/:id/status
   *
   * Valid transitions:
   *   CREATED → FUNDED | EXPIRED
   *   FUNDED  → RUNNING | REFUNDED | EXPIRED
   *   RUNNING → SUBMITTED | FAILED | EXPIRED
   *   SUBMITTED → ACCEPTED | DISPUTED | EXPIRED
   *   ACCEPTED → SETTLED | DISPUTED
   *   FAILED → REFUNDED
   *   EXPIRED → REFUNDED
   *   DISPUTED → SETTLED | REFUNDED
   */
  transitionStatus(id: string, input: TransitionJobStatusInput): Promise<Job> {
    return this.request<Job>(`/jobs/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }
}
