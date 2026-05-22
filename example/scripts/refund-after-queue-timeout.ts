import { API_URL, userClient } from "../lib/sdk-client.ts";
import { env, sendPreparedTransaction } from "../lib/transactions.ts";

const jobId = process.argv[2] ?? env("JOB_ID");

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Preparing refundAfterQueueTimeout for job ${jobId}...`);

const signedUserClient = await userClient();
const transaction = await signedUserClient.jobs.refundAfterQueueTimeout(jobId);

console.log("\nPrepared refundAfterQueueTimeout transaction:");
console.log(JSON.stringify(transaction, null, 2));

await sendPreparedTransaction("refundAfterQueueTimeout", transaction);
