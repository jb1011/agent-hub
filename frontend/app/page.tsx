import { RegisterBox } from "./components/RegisterBox";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

type Provider = {
  provider_id: string;
  name: string;
  trust_level: string;
};

type Service = {
  service_id: string;
  provider_id: string;
  name: string;
  description: string | null;
  service_type: string;
  price_usdc: string;
  status: string;
  provider?: Provider;
};

async function getServices(): Promise<Service[]> {
  try {
    const res = await fetch(`${API}/services`, { cache: "no-store" });
    console.log(res);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function getProviders(): Promise<Provider[]> {
  try {
    const res = await fetch(`${API}/providers`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

const trustBadge: Record<string, string> = {
  HOSTED: "bg-purple-500/20 text-purple-300 border border-purple-500/30",
  CERTIFIED: "bg-blue-500/20   text-blue-300   border border-blue-500/30",
  VERIFIED: "bg-green-500/20  text-green-300  border border-green-500/30",
  UNVERIFIED: "bg-gray-500/20   text-gray-400   border border-gray-500/30",
};

const statusDot: Record<string, string> = {
  ACTIVE: "bg-green-400",
  INACTIVE: "bg-yellow-400",
  SUSPENDED: "bg-red-400",
  REGISTERED: "bg-gray-400",
};

export default async function HomePage() {
  const [services, providers] = await Promise.all([
    getServices(),
    getProviders(),
  ]);

  const providerMap = Object.fromEntries(
    providers.map((p) => [p.provider_id, p]),
  );

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-white">Services</h1>
        <p className="text-gray-400">
          {services.length} service{services.length !== 1 ? "s" : ""} available
        </p>
      </div>

      {/* Providers strip */}
      {providers.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
            Providers
          </h2>
          <div className="flex flex-wrap gap-3">
            {providers.map((p) => (
              <div
                key={p.provider_id}
                className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-4 py-2"
              >
                <span className="text-sm font-medium text-white">{p.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${trustBadge[p.trust_level] ?? trustBadge.UNVERIFIED}`}
                >
                  {p.trust_level}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Register box */}
      <RegisterBox />

      {/* Services grid */}
      {services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 p-12 text-center text-gray-500">
          No services found. Make sure the backend is running at{" "}
          <code className="text-gray-400">{API}</code>.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => {
            const provider = providerMap[s.provider_id];
            return (
              <div
                key={s.service_id}
                className="flex flex-col justify-between rounded-xl border border-gray-800 bg-gray-900 p-6 hover:border-gray-600 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-white leading-tight">
                      {s.name}
                    </h3>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`h-2 w-2 rounded-full ${statusDot[s.status] ?? "bg-gray-400"}`}
                      />
                      <span className="text-xs text-gray-500">{s.status}</span>
                    </span>
                  </div>

                  {s.description && (
                    <p className="text-sm text-gray-400 line-clamp-2">
                      {s.description}
                    </p>
                  )}

                  <span className="inline-block rounded-md bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
                    {s.service_type}
                  </span>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-gray-800 pt-4">
                  <div>
                    {provider && (
                      <p className="text-xs text-gray-500">{provider.name}</p>
                    )}
                    <p className="text-xs text-gray-600 font-mono">
                      {s.service_id}
                    </p>
                  </div>
                  <span className="text-lg font-bold text-white">
                    ${s.price_usdc}
                    <span className="text-xs font-normal text-gray-400 ml-1">
                      USDC
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
