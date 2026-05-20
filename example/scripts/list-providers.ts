import { API_URL, client } from "../lib/sdk-client.ts";

const providers = await client.providers.list();

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Found ${providers.length} provider(s)`);

for (const provider of providers) {
  console.log(
    `[${provider.provider_id}] ${provider.name} status=${provider.status} trust=${provider.trust_level}`
  );
}
