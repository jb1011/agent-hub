/**
 * Quick local test — no need to publish the package.
 *
 * Run after building:
 *   npm run build          (inside backend/sdk)
 *   node examples/health-check.mjs
 *
 * Make sure the backend is running on localhost:3000 first.
 */

import { SkillHubClient } from "../dist/index.js";

const client = new SkillHubClient({ baseUrl: "http://localhost:3000" });

// Health
const health = await client.health();
console.log("health()         →", health);

// List providers
const all = await client.providers.list();
console.log("providers.list() →", all.length, "provider(s)");

// Create a provider
const created = await client.providers.create({
  provider_id: "999999",
  name: "Test Provider",
  description: "Created by the SDK example",
  owner_wallet:  "0x000000000000000000000000000000000000dead",
  payout_wallet: "0x000000000000000000000000000000000000dead",
  api_base_url: "https://example.com",
});
console.log("providers.create() →", created.provider_id, created.name);

// Get by ID (includes services)
const fetched = await client.providers.get(created.provider_id);
console.log("providers.get()  →", fetched.name, "| services:", fetched.services.length);

// Update
const updated = await client.providers.update(created.provider_id, { name: "Updated Provider" });
console.log("providers.update() →", updated.name);

// Delete
await client.providers.delete(created.provider_id);
console.log("providers.delete() → done");

