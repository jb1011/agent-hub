import type {
  Provider,
  CreateProviderInput,
  PreparedContractTransaction,
  UpdateProviderInput,
} from "./types.js";

export class ProvidersResource {
  constructor(private readonly request: <T>(path: string, init?: RequestInit) => Promise<T>) {}

  /**
   * List all registered providers.
   * GET /providers
   */
  list(): Promise<Provider[]> {
    return this.request<Provider[]>("/providers");
  }

  /**
   * Get a single provider by ID.
   * GET /providers/:id
   */
  get(providerId: string): Promise<Provider> {
    return this.request<Provider>(`/providers/${encodeURIComponent(providerId)}`);
  }

  /**
   * Register a new provider.
   * POST /providers
   */
  create(input: CreateProviderInput): Promise<PreparedContractTransaction> {
    return this.request<PreparedContractTransaction>("/providers", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Update an existing provider (partial update).
   * PATCH /providers/:id
   */
  update(providerId: string, input: UpdateProviderInput): Promise<Provider> {
    return this.request<Provider>(`/providers/${encodeURIComponent(providerId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  /**
   * Delete a provider.
   * DELETE /providers/:id
   */
  delete(providerId: string): Promise<void> {
    return this.request<void>(`/providers/${encodeURIComponent(providerId)}`, {
      method: "DELETE",
    });
  }
}
