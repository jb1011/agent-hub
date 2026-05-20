/**
 * Jobs — terminal demo
 *
 * Usage:
 *   node examples/jobs.mjs <command> [args]
 *
 * Commands:
 *   list       [status]
 *   get        <request_id|job_id>
 *   create     <user_wallet> <provider_id> [input_json]
 *   start-auth <request_id|job_id> [expires_in_seconds]
 *   start      <request_id|job_id> <provider_signature> [expires_at]
 *   finish     <request_id|job_id> <output_json>
 *   accept-req <request_id|job_id> <output_commitment> [expires_in_seconds]
 *   accept     <request_id|job_id> <output_commitment> <expires_at> <user_signature>
 *   refund-queue <request_id|job_id>
 *   refund-final <request_id|job_id>
 *
 * Examples:
 *   node examples/jobs.mjs list
 *   node examples/jobs.mjs list FUNDED
 *   node examples/jobs.mjs get abc-123
 *   node examples/jobs.mjs create 0xUserWallet 10 '{"prompt":"hello"}'
 *   node examples/jobs.mjs start-auth abc-123
 *   node examples/jobs.mjs finish abc-123 '{"result":"ok"}'
 *   node examples/jobs.mjs accept-req abc-123 0xabc...
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
  create     <user_wallet> <provider_id> [input_json]
  start-auth <request_id|job_id> [expires_in_seconds]
  start      <request_id|job_id> <provider_signature> [expires_at]
  finish     <request_id|job_id> <output_json>
  accept-req <request_id|job_id> <output_commitment> [expires_in_seconds]
  accept     <request_id|job_id> <output_commitment> <expires_at> <user_signature>
  refund-queue <request_id|job_id>
  refund-final <request_id|job_id>
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
        console.log(`  [${j.request_id}] job_id=${j.job_id ?? "—"}  status=${j.status}  provider=${j.provider_id}`);
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
      const [user_wallet, provider_id, input_json] = args;
      if (!user_wallet || !provider_id) usage();
      const result = await client.jobs.create({
        user_wallet,
        provider_id,
        ...(input_json ? { input: JSON.parse(input_json) } : {}),
      });
      console.log("\nCreate job transaction:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "start-auth": {
      const [id, expires_in_seconds] = args;
      if (!id) usage();
      const result = await client.jobs.requestStartAuthorization(id, {
        ...(expires_in_seconds ? { expires_in_seconds: Number(expires_in_seconds) } : {}),
      });
      console.log("\nStart authorization request:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "start": {
      const [id, provider_signature, expires_at] = args;
      if (!id || !provider_signature) usage();
      const result = await client.jobs.startJob(id, {
        provider_signature,
        ...(expires_at ? { expires_at: Number(expires_at) } : {}),
      });
      console.log("\nJob started:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "finish": {
      const [id, output_json] = args;
      if (!id || !output_json) usage();
      const result = await client.jobs.finishJob(id, {
        output: JSON.parse(output_json),
      });
      console.log("\nJob finished:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "accept-req": {
      const [id, output_commitment, expires_in_seconds] = args;
      if (!id || !output_commitment) usage();
      const result = await client.jobs.requestAcceptance(id, {
        output_commitment,
        ...(expires_in_seconds ? { expires_in_seconds: Number(expires_in_seconds) } : {}),
      });
      console.log("\nAcceptance request:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "accept": {
      const [id, output_commitment, expires_at, user_signature] = args;
      if (!id || !output_commitment || !expires_at || !user_signature) usage();
      const result = await client.jobs.acceptance(id, {
        output_commitment,
        expires_at: Number(expires_at),
        user_signature,
      });
      console.log("\nJob accepted and settled:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "refund-queue": {
      const [id] = args;
      if (!id) usage();
      const result = await client.jobs.refundAfterQueueTimeout(id);
      console.log("\nRefund after queue timeout transaction:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "refund-final": {
      const [id] = args;
      if (!id) usage();
      const result = await client.jobs.refundAfterFinalTimeout(id);
      console.log("\nRefund after final timeout transaction:");
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
