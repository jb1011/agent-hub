import type { UpdateProviderInput } from "../../backend/sdk/dist/index.js";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, userClient } from "../lib/sdk-client.ts";

type ProviderUpdateConfig = {
  provider_id?: string;
  provider_request_id?: string;
  updates: UpdateProviderInput;
};

const config = await readJsonConfig<ProviderUpdateConfig>("./config/provider-update.json");
const providerRequestId = process.argv[2] ?? config.provider_request_id ?? config.provider_id;

if (!providerRequestId || providerRequestId === "0xYOUR_PROVIDER_API_REQUEST_ID") {
  throw new Error(
    "Set provider_request_id in example/config/provider-update.json or pass the provider request_id as the first argument"
  );
}

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Updating provider: ${providerRequestId}`);
console.log("Provider update payload:");
console.log(JSON.stringify(config.updates, null, 2));

const signedClient = await userClient();
const provider = await signedClient.providers.update(providerRequestId, config.updates);

console.log("\nUpdated provider:");
console.log(JSON.stringify(provider, null, 2));
