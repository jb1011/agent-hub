import type { CreateProviderInput, Provider } from "../../backend/sdk/dist/index.js";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, client } from "../lib/sdk-client.ts";
import { sendPreparedTransaction } from "../lib/transactions.ts";

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 30;

async function waitForRegistryProviderId(requestId: string): Promise<Provider | null> {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    const provider = await client.providers.get(requestId);
    if (provider.registry_provider_id) {
      return provider;
    }

    console.log(
      `Waiting for registry_provider_id (${attempt}/${POLL_MAX_ATTEMPTS})...`
    );
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return null;
}

const provider = await readJsonConfig<CreateProviderInput>("./config/provider.json");

console.log(`Skill Hub API: ${API_URL}`);
console.log("Registering provider payload:");
console.log(JSON.stringify(provider, null, 2));

const result = await client.providers.create(provider);

console.log("\nProvider request_id:", result.request_id);
console.log("\nPrepared registerProvider transaction:");
console.log(JSON.stringify(result.transaction, null, 2));

const txSent = Boolean(process.env.SIGNER_WALLET_PK?.trim() && process.env.RPC_URL?.trim());

await sendPreparedTransaction("registerProvider", result.transaction, {
  expectedSigner: provider.owner_wallet,
});

if (txSent) {
  console.log("\nPolling provider until registry_provider_id is linked...");
  const linked = await waitForRegistryProviderId(result.request_id);

  if (linked?.registry_provider_id) {
    console.log("\nProvider linked on-chain:");
    console.log(
      JSON.stringify(
        {
          request_id: linked.request_id,
          registry_provider_id: linked.registry_provider_id,
          status: linked.status,
        },
        null,
        2
      )
    );
    console.log(
      `\nSet example/config/job.json → "provider_id": "${linked.registry_provider_id}" before create:job`
    );
  } else {
    console.log(
      "\nregistry_provider_id not linked yet. Ensure the backend listener runs (ARC_RPC_WS_URL) or patch the provider manually."
    );
  }
} else {
  console.log("\nAfter the on-chain transaction is confirmed:");
  console.log(`- API id (bytes32): ${result.request_id}`);
  console.log("- The registry listener fills registry_provider_id and sets status ACTIVE");
  console.log("- Copy registry_provider_id into example/config/job.json as provider_id before create:job");
}
