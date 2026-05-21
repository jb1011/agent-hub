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
  name: "Test Provider",
  description: "Created by the SDK example",
  owner_wallet:  "0x000000000000000000000000000000000000dead",
  payout_wallet: "0x000000000000000000000000000000000000dead",
  api_base_url: "https://example.com",
  service_type: "text_generation",
  price_usdc: 1,
  max_concurrent_jobs: 1,
  timeout_seconds: 300,
});
console.log("providers.create() → request_id", created.request_id, "| tx to", created.transaction.to);

// Get by ID
const fetched = await client.providers.get(created.request_id);
console.log("providers.get()  →", fetched.name, "| type:", fetched.service_type);

// Update
const updated = await client.providers.update(created.request_id, { name: "Updated Provider" });
console.log("providers.update() →", updated.name);

// Delete
await client.providers.delete(created.request_id);
console.log("providers.delete() → done");
