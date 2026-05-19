import type {
  Service,
  ServiceWithProvider,
  CreateServiceInput,
  UpdateServiceInput,
  ListServicesQuery,
} from "./types.js";

export class ServicesResource {
  constructor(private readonly request: <T>(path: string, init?: RequestInit) => Promise<T>) {}

  /**
   * List all services, optionally filtered by provider or status.
   * GET /services
   */
  list(query?: ListServicesQuery): Promise<Service[]> {
    const params = new URLSearchParams();
    if (query?.provider_id) params.set("provider_id", query.provider_id);
    if (query?.status) params.set("status", query.status);
    const qs = params.size > 0 ? `?${params}` : "";
    return this.request<Service[]>(`/services${qs}`);
  }

  /**
   * Get a single service by ID (includes provider info).
   * GET /services/:id
   */
  get(serviceId: string): Promise<ServiceWithProvider> {
    return this.request<ServiceWithProvider>(`/services/${encodeURIComponent(serviceId)}`);
  }

  /**
   * Register a new service.
   * POST /services
   */
  create(input: CreateServiceInput): Promise<Service> {
    return this.request<Service>("/services", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Update an existing service (partial update).
   * PATCH /services/:id
   */
  update(serviceId: string, input: UpdateServiceInput): Promise<Service> {
    return this.request<Service>(`/services/${encodeURIComponent(serviceId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  /**
   * Delete a service.
   * DELETE /services/:id
   */
  delete(serviceId: string): Promise<void> {
    return this.request<void>(`/services/${encodeURIComponent(serviceId)}`, {
      method: "DELETE",
    });
  }
}
