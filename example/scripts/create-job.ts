import type { CreateJobInput } from "../../backend/sdk/dist/index.js";
import { readJsonConfig } from "../lib/config.ts";
import { ensurePaymentAllowance } from "../lib/escrow-payment.ts";
import { API_URL, userClient } from "../lib/sdk-client.ts";
import { sendPreparedTransaction } from "../lib/transactions.ts";

const job = await readJsonConfig<CreateJobInput>("./config/job.json");

console.log(`Skill Hub API: ${API_URL}`);
console.log("Creating job payload:");
console.log(JSON.stringify(job, null, 2));

const signedUserClient = await userClient();
const transaction = await signedUserClient.jobs.create(job);

console.log("\nPrepared createJob transaction:");
console.log(JSON.stringify(transaction, null, 2));

if (process.env.SIGNER_WALLET_PK?.trim()) {
  await ensurePaymentAllowance(
    job.user_wallet,
    transaction.to,
    job.provider_id,
  );
} else {
  console.log(
    "\nSIGNER_WALLET_PK is not set, so allowance was not checked and approve was not sent.",
  );
}

await sendPreparedTransaction("createJob", transaction, {
  expectedSigner: job.user_wallet,
});
