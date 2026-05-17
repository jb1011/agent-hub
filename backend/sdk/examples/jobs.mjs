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
 *   link       <request_id> <job_id>
 *   status     <request_id|job_id> <new_status>
 *
 * Examples:
 *   node examples/jobs.mjs list
 *   node examples/jobs.mjs list FUNDED
 *   node examples/jobs.mjs get abc-123
 *   node examples/jobs.mjs create 0xUserWallet 10
 *   node examples/jobs.mjs link abc-123 42
 *   node examples/jobs.mjs status abc-123 RUNNING
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
  link       <request_id> <job_id>
  status     <request_id|job_id> <new_status>

Valid statuses: CREATED FUNDED RUNNING SUBMITTED ACCEPTED SETTLED FAILED EXPIRED REFUNDED DISPUTED
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

    case "link": {
      const [id, job_id] = args;
      if (!id || !job_id) usage();
      const job = await client.jobs.linkOnchainJob(id, job_id);
      console.log("\nLinked job:");
      console.log(JSON.stringify(job, null, 2));
      break;
    }

    case "status": {
      const [id, status] = args;
      if (!id || !status) usage();
      const job = await client.jobs.transitionStatus(id, { status });
      console.log(`\nJob status updated to ${job.status}:`);
      console.log(JSON.stringify(job, null, 2));
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
