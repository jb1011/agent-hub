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
  work_deadline: string | null;
  review_deadline: string | null;
  funded_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobWithDetails extends Job {
  escrow: Escrow | null;
  service: {
    service_id: string;
    name: string;
    price_usdc: string;
  };
}

export interface CreateJobArgs {
  service_id: string;
  request_id: string;
  input_commitment: string;
  queue_timeout_seconds: number;
  expires_at: number;
  delivery_attester_signature: string;
}

export interface CreateJobResult extends Job {
  create_job_args: CreateJobArgs;
}

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

export interface TransitionJobStatusInput {
  status: JobStatus;
  output_uri?: string;
  output_hash?: string;
  error_message?: string;
}

export interface ListJobsQuery {
  request_id?: string;
  job_id?: string;
  user_wallet?: string;
  service_id?: string;
  status?: JobStatus;
}

// ---------------------------------------------------------------------------
// Escrows
// ---------------------------------------------------------------------------

export type EscrowStatus = "UNFUNDED" | "LOCKED" | "RELEASED" | "REFUNDED" | "DISPUTED";

export interface Escrow {
  escrow_id: string;
  request_id: string;
  chain_id: number;
  token_address: string;
  escrow_contract: string;
  amount_usdc: number;
  platform_fee_usdc: number;
  provider_payout_usdc: number;
  escrow_status: EscrowStatus;
  fund_tx_hash: string | null;
  release_tx_hash: string | null;
  refund_tx_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEscrowInput {
  request_id: string;
  chain_id: number;
  token_address: string;
  escrow_contract: string;
  amount_usdc: number;
  platform_fee_usdc: number;
  provider_payout_usdc: number;
}
