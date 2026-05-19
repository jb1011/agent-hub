/**
 * Jobs — terminal demo
 *
 * Usage:
 *   node examples/jobs.mjs <command> [args]
 *
 * Commands:
 *   list       [status]
 *   get        <request_id|job_id>
 *   create     <user_wallet> <service_id>
 *   finish     <request_id|job_id> <output_json> [output_uri]
 *
 * Examples:
 *   node examples/jobs.mjs list
 *   node examples/jobs.mjs list FUNDED
 *   node examples/jobs.mjs get abc-123
 *   node examples/jobs.mjs create 0xUserWallet 10
 *   node examples/jobs.mjs finish abc-123 '{"result":"ok"}' ipfs://output
 */

import { SkillHubClient } from "../dist/index.js";

const BASE_URL = process.env.API_URL ?? "http://localhost:3000";
const client = new SkillHubClient({ baseUrl: BASE_URL });

const [, , command, ...args] = process.argv;

function usage() {
  console.log(`
Usage: node examples/jobs.mjs <command> [args]

  list       [status]
  get        <request_id|job_id>
  create     <user_wallet> <service_id>
  finish     <request_id|job_id> <output_json> [output_uri]
`);
  process.exit(1);
}

async function run() {
  switch (command) {
    case "list": {
      const [status] = args;
      const jobs = await client.jobs.list(status ? { status } : undefined);
      console.log(`Found ${jobs.length} job(s):\n`);
      for (const j of jobs) {
        console.log(`  [${j.request_id}] job_id=${j.job_id ?? "—"}  status=${j.status}  service=${j.service_id}`);
      }
      break;
    }

    case "get": {
      const [id] = args;
      if (!id) usage();
      const job = await client.jobs.get(id);
      console.log("\nJob:");
      console.log(JSON.stringify(job, null, 2));
      break;
    }

    case "create": {
      const [user_wallet, service_id] = args;
      if (!user_wallet || !service_id) usage();
      const result = await client.jobs.create({ user_wallet, service_id });
      console.log("\nJob created:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "finish": {
      const [id, output_json, output_uri] = args;
      if (!id || !output_json) usage();
      const result = await client.jobs.finishJob(id, {
        output: JSON.parse(output_json),
        ...(output_uri ? { output_uri } : {}),
      });
      console.log("\nJob finished:");
      console.log(JSON.stringify(result, null, 2));
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
