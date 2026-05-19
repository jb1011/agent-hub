import type { HealthResponse, SkillHubClientOptions } from "./types.js";
import { ProvidersResource } from "./providers.js";
import { ServicesResource } from "./services.js";
import { JobsResource } from "./jobs.js";

export class SkillHubClient {
  private baseUrl: string;

  /** Provider CRUD operations */
  readonly providers: ProvidersResource;

  /** Service CRUD operations */
  readonly services: ServicesResource;

  /** Job lifecycle operations */
  readonly jobs: JobsResource;

  constructor(options: SkillHubClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
    this.providers = new ProvidersResource(this.request.bind(this));
    this.services = new ServicesResource(this.request.bind(this));
    this.jobs = new JobsResource(this.request.bind(this));
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Skill Hub API error ${res.status}: ${text}`);
    }

    // DELETE / dispute return 204 No Content
    if (res.status === 204) return null as T;

    return res.json() as Promise<T>;
  }

  /**
   * Checks whether the Skill Hub API is reachable and healthy.
   * GET /health
   */
  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }
}
