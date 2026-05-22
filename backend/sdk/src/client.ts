import type { HealthResponse, SkillHubClientOptions } from "./types.js";
import { ProvidersResource } from "./providers.js";
import { JobsResource } from "./jobs.js";
import { buildProviderRequestHeaders, isProviderAuthenticatedPath } from "./provider-auth.js";

function requestBodyString(init?: RequestInit): string {
  if (typeof init?.body === "string") return init.body;
  if (init?.body == null) return "";
  throw new Error("Provider-authenticated requests must use a string body");
}

export class SkillHubClient {
  private baseUrl: string;
  private providerAuth: SkillHubClientOptions["providerAuth"];
  private userAuth: SkillHubClientOptions["userAuth"];

  /** Provider CRUD operations */
  readonly providers: ProvidersResource;

  /** Job lifecycle operations */
  readonly jobs: JobsResource;

  constructor(options: SkillHubClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
    this.providerAuth = options.providerAuth;
    this.userAuth = options.userAuth;
    this.providers = new ProvidersResource(this.request.bind(this));
    this.jobs = new JobsResource(this.request.bind(this));
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");

    if (this.providerAuth && isProviderAuthenticatedPath(path)) {
      const authHeaders = await buildProviderRequestHeaders({
        path,
        body: requestBodyString(init),
        auth: this.providerAuth,
      });
      for (const [key, value] of Object.entries(authHeaders)) {
        headers.set(key, value);
      }
    }

    if (this.userAuth) {
      const accessToken = typeof this.userAuth.accessToken === "function"
        ? await this.userAuth.accessToken()
        : this.userAuth.accessToken;
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    const res = await fetch(url, {
      ...init,
      headers,
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
