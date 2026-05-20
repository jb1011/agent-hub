import type { AcceptanceInput, OutputCommitmentInput } from "../../backend/sdk/dist/index.js";
import type { Eip712TypedData } from "../lib/transactions.ts";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, client } from "../lib/sdk-client.ts";
import { signTypedData } from "../lib/transactions.ts";

type AcceptanceConfig = OutputCommitmentInput & {
  job_id: string;
};

const config = await readJsonConfig<AcceptanceConfig>("./config/acceptance.json");
const { job_id, ...outputCommitment } = config;

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Requesting acceptance typed data for job ${job_id}...`);

const acceptanceRequest = await client.jobs.requestAcceptance(job_id, outputCommitment);

console.log("\nAcceptance typed data:");
console.log(JSON.stringify(acceptanceRequest, null, 2));

const user_signature = await signTypedData(
  "JobAcceptance",
  acceptanceRequest.typed_data as Eip712TypedData
);

console.log("\nUser signature:");
console.log(user_signature);

const acceptanceInput: AcceptanceInput = {
  ...outputCommitment,
  output_commitment: acceptanceRequest.settle_with_user_signature_args.output_commitment,
  expires_at: acceptanceRequest.settle_with_user_signature_args.expires_at,
  user_signature,
};

console.log("\nSubmitting acceptance...");
const accepted = await client.jobs.acceptance(job_id, acceptanceInput);

console.log("\nJob accepted and settled:");
console.log(JSON.stringify(accepted, null, 2));
