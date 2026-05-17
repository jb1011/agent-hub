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
