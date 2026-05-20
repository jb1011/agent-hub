export interface SkillHubClientOptions {
  /**
   * Base URL of the Skill Hub API.
   * @example "https://api.skill-hub.xyz"
   * @default "http://localhost:3000"
   */
  baseUrl?: string;
}

export interface HealthResponse {
  ok: boolean;
}

export interface PreparedContractTransaction {
  to: string;
  data: string;
  value: "0";
  from?: string;
  chain_id?: number;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export type ProviderTrustLevel = "UNVERIFIED" | "VERIFIED" | "CERTIFIED" | "HOSTED";
export type ProviderStatus = "REGISTERED" | "ACTIVE" | "SUSPENDED";

export interface Provider {
  provider_id: string;
  name: string;
  description: string | null;
  owner_wallet: string;
  payout_wallet: string;
  api_base_url: string;
  trust_level: ProviderTrustLevel;
  status: ProviderStatus;
  created_at: string;
  updated_at: string;
}

export interface ProviderWithServices extends Provider {
  services: Array<{
    service_id: string;
    name: string;
    max_concurrent_jobs: number;
    status: string;
  }>;
}

export interface CreateProviderInput {
  provider_id: string;
  name: string;
  description?: string;
  owner_wallet: string;
  payout_wallet: string;
  api_base_url: string;
  trust_level?: ProviderTrustLevel;
  status?: ProviderStatus;
}

export type UpdateProviderInput = Partial<Omit<CreateProviderInput, "provider_id">>;

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export type ServiceStatus = "REGISTERED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";

export interface Service {
  service_id: string;
  provider_id: string;
  name: string;
  description: string | null;
  service_type: string;
  endpoint_path: string;
  input_schema: unknown;
  output_schema: unknown;
  price_usdc: string;
  max_concurrent_jobs: number;
  timeout_seconds: number | null;
  status: ServiceStatus;
  created_at: string;
  updated_at: string;
}

export interface ServiceWithProvider extends Service {
  provider: {
    provider_id: string;
    name: string;
    trust_level: string;
  };
}

export interface CreateServiceInput {
  service_id: string;
  provider_id: string;
  name: string;
  description?: string;
  service_type: string;
  endpoint_path: string;
  input_schema?: unknown;
  output_schema?: unknown;
  price_usdc: number;
  max_concurrent_jobs: number;
  timeout_seconds?: number;
  status?: ServiceStatus;
}

export type UpdateServiceInput = Partial<Omit<CreateServiceInput, "service_id" | "provider_id">>;

export interface ListServicesQuery {
  provider_id?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobStatus =
  | "CREATED" | "FUNDED" | "RUNNING" | "SUBMITTED"
  | "ACCEPTED" | "SETTLED" | "FAILED" | "EXPIRED" | "REFUNDED" | "DISPUTED";

export interface Job {
  request_id: string;
  job_id: string | null;
  user_wallet: string;
  service_id: string;
  status: JobStatus;
  input_uri: string | null;
  input_hash: string | null;
  output_uri: string | null;
  output_hash: string | null;
  error_message: string | null;
  queue_deadline: string | null;
  work_deadline: string | null;
  review_deadline: string | null;
  final_refund_deadline: string | null;
  delivered_at: string | null;
  delivery_attestation: StoredDeliveryAttestation | null;
  no_delivery_attestation: StoredNoDeliveryAttestation | null;
  no_delivery_attested_at: string | null;
  funded_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface JobWithDetails extends Job {
  escrow: Escrow | null;
  service: {
    service_id: string;
    name: string;
    price_usdc: string;
  };
}

export type CreateJobResult = PreparedContractTransaction;

export interface CreateJobInput {
  job_id?: string;
  request_id?: string;
  user_wallet: string;
  service_id: string;
  input_uri?: string;
  input_hash?: string;
  input_commitment?: string;
  queue_timeout_seconds?: number;
  authorization_expires_at?: number;
  authorization_expires_in_seconds?: number;
  work_deadline?: string;
  review_deadline?: string;
}

export interface ListJobsQuery {
  request_id?: string;
  job_id?: string;
  user_wallet?: string;
  service_id?: string;
  status?: JobStatus;
}

export interface AuthorizationExpiryInput {
  expires_at?: number;
  expires_in_seconds?: number;
}

export interface TypedDataResponse {
  typed_data: unknown;
}

export interface StartJobArgs {
  job_id: string;
  expires_at: number;
}

export interface StartAuthorizationRequestResult extends TypedDataResponse {
  start_job_args: StartJobArgs;
}

export interface StartJobInput extends AuthorizationExpiryInput {
  provider_signature: string;
}

export interface StartJobResult {
  input_uri: string | null;
  transaction_hash: string;
  relayer_address: string;
  block_number: number | null;
  gas_used: string | null;
}

export interface OutputCommitmentInput extends AuthorizationExpiryInput {
  output_uri?: string;
  output_hash?: string;
  output_commitment?: string;
}

export interface FinishJobInput extends OutputCommitmentInput {
  output?: unknown;
}

export interface SettleAfterReviewTimeoutArgs {
  job_id: string;
  output_commitment: string;
  delivered_at: number;
  expires_at: number;
  delivery_attester_signature: string;
}

export interface StoredDeliveryAttestation {
  delivered_at: number;
  expires_at: number;
  delivery_attester_signature: string;
  settle_after_review_timeout_args: SettleAfterReviewTimeoutArgs;
}

export interface FinishJobResult extends Omit<Job, "delivery_attestation"> {
  delivery_attestation: SettleAfterReviewTimeoutArgs;
  settle_after_review_timeout_args: SettleAfterReviewTimeoutArgs;
}

/**
 * @deprecated Use FinishJobInput. The API now exposes POST /jobs/:id/job-finish.
 */
export type DeliveryAttestationInput = FinishJobInput;

/**
 * @deprecated Use FinishJobResult. The API now exposes POST /jobs/:id/job-finish.
 */
export type DeliveryAttestationResult = FinishJobResult;

export interface RefundWithNoDeliveryAttestationArgs {
  job_id: string;
  checked_at: number;
  expires_at: number;
  no_delivery_attester_signature: string;
}

export interface StoredNoDeliveryAttestation {
  checked_at: number;
  expires_at: number;
  no_delivery_attester_signature: string;
  refund_with_no_delivery_attestation_args: RefundWithNoDeliveryAttestationArgs;
}

export interface SettleWithUserSignatureArgs {
  job_id: string;
  output_commitment: string;
  expires_at: number;
}

export interface AcceptanceRequestResult extends TypedDataResponse {
  settle_with_user_signature_args: SettleWithUserSignatureArgs;
}

export interface AcceptanceInput extends OutputCommitmentInput {
  expires_at: number;
  user_signature: string;
}

export interface AcceptanceResult extends Job {
  settle_with_user_signature_args: SettleWithUserSignatureArgs & {
    user_signature: string;
  };
  transaction_hash: string;
  relayer_address: string;
  block_number: number | null;
  gas_used: string | null;
  provider_payout_wallet: string | null;
  provider_amount: string | null;
  protocol_fee: string | null;
}

/**
 * @deprecated Use AcceptanceInput. The API now relays settlement through
 * POST /jobs/:id/acceptance.
 */
export type SettleWithUserSignatureInput = AcceptanceInput;

/**
 * @deprecated Use AcceptanceResult. The API now relays settlement through
 * POST /jobs/:id/acceptance.
 */
export type SettleWithUserSignatureResult = AcceptanceResult;

export type RefundAfterQueueTimeoutResult = PreparedContractTransaction;

export type RefundAfterFinalTimeoutResult = PreparedContractTransaction;

// ---------------------------------------------------------------------------
// Escrow data included in job responses
// ---------------------------------------------------------------------------

export type EscrowStatus = "UNFUNDED" | "LOCKED" | "RELEASED" | "REFUNDED" | "DISPUTED";

export interface Escrow {
  escrow_id: string;
  request_id: string;
  chain_id: number;
  token_address: string;
  escrow_contract: string;
  amount_usdc: string;
  platform_fee_usdc: string;
  provider_payout_usdc: string;
  escrow_status: EscrowStatus;
  fund_tx_hash: string | null;
  release_tx_hash: string | null;
  refund_tx_hash: string | null;
  created_at: string;
  updated_at: string;
}
