import { API_URL, client } from "../lib/sdk-client.ts";

const providers = await client.providers.list();

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Found ${providers.length} provider(s)`);

for (const provider of providers) {
  const onChain = provider.registry_provider_id ?? "pending";
  console.log(
    `[${provider.request_id}] ${provider.name} service=${provider.service_type} price=${provider.price_usdc} USDC registry=${onChain} status=${provider.status} trust=${provider.trust_level} signer=${provider.signer_wallet}`
  );
}
