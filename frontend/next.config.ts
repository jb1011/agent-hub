import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000"}/:path*`,
      },
    ];
  },
  webpack: (config) => {
    // wagmi v3's @wagmi/connectors barrel pulls in optional peer connectors
    // (porto, tempo, walletConnect, coinbase, safe, base) that we don't use.
    // Stub them out so the build doesn't fail trying to resolve modules
    // we never call into.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "porto/internal": false,
      porto: false,
      accounts: false,
      "@base-org/account": false,
      "@coinbase/wallet-sdk": false,
      "@metamask/connect-evm": false,
      "@safe-global/safe-apps-provider": false,
      "@safe-global/safe-apps-sdk": false,
      "@walletconnect/ethereum-provider": false,
    };
    return config;
  },
};

export default nextConfig;
