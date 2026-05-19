import type { Provider, Service, Job, Escrow } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";

function dec(d: Decimal | null | undefined): string | null {
  return d != null ? d.toString() : null;
}

function dt(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function serializeProvider(p: Provider) {
  return {
    provider_id: p.provider_id,
    name: p.name,
    description: p.description,
    status: p.status,
    owner_wallet: p.owner_wallet,
    payout_wallet: p.payout_wallet,
    api_base_url: p.api_base_url,
    trust_level: p.trust_level,
    created_at: dt(p.created_at),
    updated_at: dt(p.updated_at),
  };
}

export function serializeService(s: Service) {
  return {
    service_id: s.service_id,
    provider_id: s.provider_id,
    name: s.name,
    description: s.description,
    service_type: s.service_type,
    endpoint_path: s.endpoint_path,
    input_schema: s.input_schema,
    output_schema: s.output_schema,
    price_usdc: dec(s.price_usdc),
    max_concurrent_jobs: s.max_concurrent_jobs,
    timeout_seconds: s.timeout_seconds,
    status: s.status,
    created_at: dt(s.created_at),
    updated_at: dt(s.updated_at),
  };
}

export function serializeJob(j: Job) {
  return {
    request_id: j.request_id,
    job_id: j.job_id,
    user_wallet: j.user_wallet,
    service_id: j.service_id,
    status: j.status,
    input_uri: j.input_uri,
    input_hash: j.input_hash,
    output_uri: j.output_uri,
    output_hash: j.output_hash,
    created_at: dt(j.created_at),
    funded_at: dt(j.funded_at),
    started_at: dt(j.started_at),
    submitted_at: dt(j.submitted_at),
    accepted_at: dt(j.accepted_at),
    settled_at: dt(j.settled_at),
    queue_deadline: dt(j.queue_deadline),
    work_deadline: dt(j.work_deadline),
    review_deadline: dt(j.review_deadline),
    final_refund_deadline: dt(j.final_refund_deadline),
    delivered_at: dt(j.delivered_at),
    delivery_attestation: j.delivery_attestation,
    no_delivery_attestation: j.no_delivery_attestation,
    no_delivery_attested_at: dt(j.no_delivery_attested_at),
    error_message: j.error_message,
  };
}

export function serializeEscrow(e: Escrow) {
  return {
    escrow_id: e.escrow_id,
    request_id: e.request_id,
    chain_id: e.chain_id,
    token_address: e.token_address,
    escrow_contract: e.escrow_contract,
    amount_usdc: dec(e.amount_usdc),
    platform_fee_usdc: dec(e.platform_fee_usdc),
    provider_payout_usdc: dec(e.provider_payout_usdc),
    escrow_status: e.escrow_status,
    fund_tx_hash: e.fund_tx_hash,
    release_tx_hash: e.release_tx_hash,
    refund_tx_hash: e.refund_tx_hash,
    created_at: dt(e.created_at),
    updated_at: dt(e.updated_at),
  };
}
