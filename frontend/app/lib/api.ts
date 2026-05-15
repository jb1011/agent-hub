const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export type Provider = {
  provider_id: string;
  name: string;
  trust_level: string;
};

export type Service = {
  service_id: string;
  provider_id: string;
  name: string;
  description: string | null;
  service_type: string;
  price_usdc: string;
  status: string;
};

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export const apiKeys = {
  providers: ["providers"] as const,
  services: ["services"] as const,
};

export const fetchProviders = (): Promise<Provider[]> =>
  apiFetch<Provider[]>("/providers");

export const fetchServices = (): Promise<Service[]> =>
  apiFetch<Service[]>("/services");
