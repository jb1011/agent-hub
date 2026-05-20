import type {
  Job,
  JobWithDetails,
  CreateJobInput,
  CreateJobResult,
  ListJobsQuery,
  AuthorizationExpiryInput,
  StartAuthorizationRequestResult,
  StartJobInput,
  StartJobResult,
  FinishJobInput,
  FinishJobResult,
  OutputCommitmentInput,
  AcceptanceRequestResult,
  AcceptanceInput,
  AcceptanceResult,
  SettleWithUserSignatureInput,
  SettleWithUserSignatureResult,
  RefundAfterQueueTimeoutResult,
  RefundAfterFinalTimeoutResult,
} from "./types.js";

export class JobsResource {
  constructor(private readonly request: <T>(path: string, init?: RequestInit) => Promise<T>) {}

  private path(id: string, suffix = ""): string {
    return `/jobs/${encodeURIComponent(id)}${suffix}`;
  }

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
    return this.request<JobWithDetails>(this.path(id));
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
   * Build the EIP-712 payload the provider signs before startJob.
   * POST /jobs/:id/start-authorization-request
   */
  requestStartAuthorization(
    id: string,
    input: AuthorizationExpiryInput = {}
  ): Promise<StartAuthorizationRequestResult> {
    return this.request<StartAuthorizationRequestResult>(
      this.path(id, "/start-authorization-request"),
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  }

  /**
   * Relay startJob after the provider signed StartJobAuthorization.
   * POST /jobs/:id/start-job
   */
  startJob(id: string, input: StartJobInput): Promise<StartJobResult> {
    return this.request<StartJobResult>(this.path(id, "/start-job"), {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Finish a running job, validate provider output, and return DeliveryAttestation.
   * POST /jobs/:id/job-finish
   */
  finishJob(
    id: string,
    input: FinishJobInput
  ): Promise<FinishJobResult> {
    return this.request<FinishJobResult>(
      this.path(id, "/job-finish"),
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  }

  /**
   * Build the EIP-712 payload the user signs to accept output.
   * POST /jobs/:id/acceptance-request
   */
  requestAcceptance(
    id: string,
    input: OutputCommitmentInput
  ): Promise<AcceptanceRequestResult> {
    return this.request<AcceptanceRequestResult>(this.path(id, "/acceptance-request"), {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Submit user acceptance and relay settleWithUserSignature.
   * POST /jobs/:id/acceptance
   */
  acceptance(id: string, input: AcceptanceInput): Promise<AcceptanceResult> {
    return this.request<AcceptanceResult>(this.path(id, "/acceptance"), {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * @deprecated Use acceptance(). This method calls POST /jobs/:id/acceptance.
   */
  settleWithUserSignature(
    id: string,
    input: SettleWithUserSignatureInput
  ): Promise<SettleWithUserSignatureResult> {
    return this.acceptance(id, input);
  }

  /**
   * Return refundAfterQueueTimeout calldata arguments after queue deadline.
   * POST /jobs/:id/refund-after-queue-timeout
   */
  refundAfterQueueTimeout(id: string): Promise<RefundAfterQueueTimeoutResult> {
    return this.request<RefundAfterQueueTimeoutResult>(
      this.path(id, "/refund-after-queue-timeout"),
      { method: "POST" }
    );
  }

  /**
   * Return refundAfterFinalTimeout calldata arguments after final refund deadline.
   * POST /jobs/:id/refund-after-final-timeout
   */
  refundAfterFinalTimeout(id: string): Promise<RefundAfterFinalTimeoutResult> {
    return this.request<RefundAfterFinalTimeoutResult>(
      this.path(id, "/refund-after-final-timeout"),
      { method: "POST" }
    );
  }
}
