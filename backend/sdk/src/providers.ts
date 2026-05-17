import type {
  Provider,
  ProviderWithServices,
  CreateProviderInput,
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
   * Get a single provider by ID (includes its services).
   * GET /providers/:id
   */
  get(providerId: string): Promise<ProviderWithServices> {
    return this.request<ProviderWithServices>(`/providers/${providerId}`);
  }

  /**
   * Register a new provider.
   * POST /providers
   */
  create(input: CreateProviderInput): Promise<Provider> {
    return this.request<Provider>("/providers", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Update an existing provider (partial update).
   * PATCH /providers/:id
   */
  update(providerId: string, input: UpdateProviderInput): Promise<Provider> {
    return this.request<Provider>(`/providers/${providerId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  /**
   * Delete a provider.
   * DELETE /providers/:id
   */
  async delete(providerId: string): Promise<void> {
    await this.request<null>(`/providers/${providerId}`, { method: "DELETE" });
  }
}
