/**
 * Escrows — terminal demo
 *
 * Usage:
 *   node examples/escrows.mjs <command> [args]
 *
 * Commands:
 *   get        <escrow_id>
 *   get-job    <request_id|job_id>
 *   create     <request_id> <chain_id> <token_address> <escrow_contract> <amount_usdc> <platform_fee_usdc> <provider_payout_usdc>
 *   fund       <escrow_id> <tx_hash>
 *   release    <escrow_id> <tx_hash>
 *   refund     <escrow_id> <tx_hash>
 *   dispute    <escrow_id>
 *
 * Examples:
 *   node examples/escrows.mjs get abc-123-escrow
 *   node examples/escrows.mjs get-job abc-request-id
 *   node examples/escrows.mjs create abc-request-id 8453 0xUSDC 0xEscrowContract 1.0 0.1 0.9
 *   node examples/escrows.mjs fund abc-123-escrow 0xFundTxHash
 *   node examples/escrows.mjs release abc-123-escrow 0xReleaseTxHash
 *   node examples/escrows.mjs refund abc-123-escrow 0xRefundTxHash
 *   node examples/escrows.mjs dispute abc-123-escrow
 */

import { SkillHubClient } from "../dist/index.js";

const BASE_URL = process.env.API_URL ?? "http://localhost:3000";
const client = new SkillHubClient({ baseUrl: BASE_URL });

const [, , command, ...args] = process.argv;

function usage() {
  console.log(`
Usage: node examples/escrows.mjs <command> [args]

  get        <escrow_id>
  get-job    <request_id|job_id>
  create     <request_id> <chain_id> <token_addr> <escrow_contract> <amount> <platform_fee> <provider_payout>
  fund       <escrow_id> <tx_hash>
  release    <escrow_id> <tx_hash>
  refund     <escrow_id> <tx_hash>
  dispute    <escrow_id>
`);
  process.exit(1);
}

async function run() {
  switch (command) {
    case "get": {
      const [id] = args;
      if (!id) usage();
      const escrow = await client.escrows.get(id);
      console.log("\nEscrow:");
      console.log(JSON.stringify(escrow, null, 2));
      break;
    }

    case "get-job": {
      const [id] = args;
      if (!id) usage();
      const escrow = await client.escrows.getByJob(id);
      console.log("\nEscrow for job:");
      console.log(JSON.stringify(escrow, null, 2));
      break;
    }

    case "create": {
      const [request_id, chain_id, token_address, escrow_contract, amount_usdc, platform_fee_usdc, provider_payout_usdc] = args;
      if (!request_id || !chain_id || !token_address || !escrow_contract || !amount_usdc || !platform_fee_usdc || !provider_payout_usdc) usage();
      const escrow = await client.escrows.create({
        request_id,
        chain_id: Number(chain_id),
        token_address,
        escrow_contract,
        amount_usdc: Number(amount_usdc),
        platform_fee_usdc: Number(platform_fee_usdc),
        provider_payout_usdc: Number(provider_payout_usdc),
      });
      console.log("\nEscrow created:");
      console.log(JSON.stringify(escrow, null, 2));
      break;
    }

    case "fund": {
      const [id, tx_hash] = args;
      if (!id || !tx_hash) usage();
      const escrow = await client.escrows.fund(id, tx_hash);
      console.log(`\nEscrow funded (status: ${escrow.escrow_status}):`);
      console.log(JSON.stringify(escrow, null, 2));
      break;
    }

    case "release": {
      const [id, tx_hash] = args;
      if (!id || !tx_hash) usage();
      const escrow = await client.escrows.release(id, tx_hash);
      console.log(`\nEscrow released (status: ${escrow.escrow_status}):`);
      console.log(JSON.stringify(escrow, null, 2));
      break;
    }

    case "refund": {
      const [id, tx_hash] = args;
      if (!id || !tx_hash) usage();
      const escrow = await client.escrows.refund(id, tx_hash);
      console.log(`\nEscrow refunded (status: ${escrow.escrow_status}):`);
      console.log(JSON.stringify(escrow, null, 2));
      break;
    }

    case "dispute": {
      const [id] = args;
      if (!id) usage();
      const escrow = await client.escrows.dispute(id);
      console.log(`\nEscrow disputed (status: ${escrow.escrow_status}):`);
      console.log(JSON.stringify(escrow, null, 2));
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
