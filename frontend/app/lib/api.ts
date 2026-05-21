import type { Provider } from "skillhub-sdk";

export type { Provider };

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export const apiKeys = {
  providers: ["providers"] as const,
  provider: (id: string) => ["providers", id] as const,
};

export const fetchProviders = (): Promise<Provider[]> =>
  apiFetch<Provider[]>("/providers");

export const fetchProvider = (requestId: string): Promise<Provider> =>
  apiFetch<Provider>(`/providers/${encodeURIComponent(requestId)}`);
