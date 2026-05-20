/**
 * Services — terminal demo
 *
 * Usage:
 *   node examples/services.mjs <command> [args]
 *
 * Commands:
 *   list     [provider_id] [status]
 *   get      <service_id>
 *   create   <service_id> <provider_id> <name> <service_type> <endpoint_path> <price_usdc>
 *   update   <service_id> <json_patch>
 *
 * Examples:
 *   node examples/services.mjs list
 *   node examples/services.mjs list 1 ACTIVE
 *   node examples/services.mjs get 10
 *   node examples/services.mjs create 10 1 "Image Gen" image_generation /generate 0.5
 *   node examples/services.mjs update 10 '{"status":"ACTIVE"}'
 */

import { SkillHubClient } from "../dist/index.js";

const BASE_URL = process.env.API_URL ?? "http://localhost:3000";
const client = new SkillHubClient({ baseUrl: BASE_URL });

const [, , command, ...args] = process.argv;

function usage() {
  console.log(`
Usage: node examples/services.mjs <command> [args]

  list     [provider_id] [status]
  get      <service_id>
  create   <service_id> <provider_id> <name> <service_type> <endpoint_path> <price_usdc>
  update   <service_id> <json_patch>
`);
  process.exit(1);
}

async function run() {
  switch (command) {
    case "list": {
      const [provider_id, status] = args;
      const services = await client.services.list({ provider_id, status });
      console.log(`Found ${services.length} service(s):\n`);
      for (const s of services) {
        console.log(`  [${s.service_id}] ${s.name}  price=${s.price_usdc} USDC  status=${s.status}`);
      }
      break;
    }

    case "get": {
      const [id] = args;
      if (!id) usage();
      const service = await client.services.get(id);
      console.log("\nService:");
      console.log(JSON.stringify(service, null, 2));
      break;
    }

    case "create": {
      const [service_id, provider_id, name, service_type, endpoint_path, price_usdc] = args;
      if (!service_id || !provider_id || !name || !service_type || !endpoint_path || !price_usdc) usage();
      const created = await client.services.create({
        service_id,
        provider_id,
        name,
        service_type,
        endpoint_path,
        price_usdc: Number(price_usdc),
      });
      console.log("\nCreate service transaction:");
      console.log(JSON.stringify(created, null, 2));
      break;
    }

    case "update": {
      const [id, patch] = args;
      if (!id || !patch) usage();
      const updated = await client.services.update(id, JSON.parse(patch));
      console.log("\nUpdated service:");
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
