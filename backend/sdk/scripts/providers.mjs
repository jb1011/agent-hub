/**
 * Providers — terminal demo
 *
 * Usage:
 *   node scripts/providers.mjs [command] [args...]
 *
 * Commands:
 *   list
 *   get        <provider_id>
 *   create     <provider_id> <name> <owner_wallet> <payout_wallet> <api_base_url> <service_type> <price_usdc>
 *   update     <provider_id> <json_patch>
 *
 * Examples:
 *   node scripts/providers.mjs list
 *   node scripts/providers.mjs get 123
 *   node scripts/providers.mjs create 42 "My Agent" 0xabc 0xabc https://my-agent.xyz text_generation 1
 *   node scripts/providers.mjs update 42 '{"status":"ACTIVE"}'
 */

import { SkillHubClient } from "../dist/index.js";

const BASE_URL = process.env.API_URL ?? "http://localhost:3000";
const client = new SkillHubClient({ baseUrl: BASE_URL });

const [, , command, ...args] = process.argv;

function usage() {
  console.log(`
Usage: node scripts/providers.mjs <command> [args]

  list
  get        <provider_id>
  create     <provider_id> <name> <owner_wallet> <payout_wallet> <api_base_url> <service_type> <price_usdc>
  update     <provider_id> <json_patch>
`);
  process.exit(1);
}

async function run() {
  switch (command) {
    case "list": {
      const providers = await client.providers.list();
      console.log(`Found ${providers.length} provider(s):\n`);
      for (const p of providers) {
        console.log(`  [${p.provider_id}] ${p.name}  status=${p.status}  trust=${p.trust_level}`);
      }
      break;
    }

    case "get": {
      const [id] = args;
      if (!id) usage();
      const provider = await client.providers.get(id);
      console.log("\nProvider:");
      console.log(JSON.stringify(provider, null, 2));
      break;
    }

    case "create": {
      const [provider_id, name, owner_wallet, payout_wallet, api_base_url, service_type, price_usdc] = args;
      if (!provider_id || !name || !owner_wallet || !payout_wallet || !api_base_url || !service_type || !price_usdc) {
        usage();
      }
      const created = await client.providers.create({
        provider_id,
        name,
        owner_wallet,
        payout_wallet,
        api_base_url,
        service_type,
        price_usdc: Number(price_usdc),
        max_concurrent_jobs: 1,
        timeout_seconds: 300,
      });
      console.log("\nCreate provider transaction:");
      console.log(JSON.stringify(created, null, 2));
      break;
    }

    case "update": {
      const [id, patch] = args;
      if (!id || !patch) usage();
      const updated = await client.providers.update(id, JSON.parse(patch));
      console.log("\nUpdated provider:");
      console.log(JSON.stringify(updated, null, 2));
      break;
    }

    default:
      usage();
  }
}

run().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
