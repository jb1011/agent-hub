import type { Escrow, CreateEscrowInput } from "./types.js";

export class EscrowsResource {
  constructor(private readonly request: <T>(path: string, init?: RequestInit) => Promise<T>) {}

  /**
   * Get an escrow by escrow_id.
   * GET /escrows/:id
   */
  get(escrowId: string): Promise<Escrow> {
    return this.request<Escrow>(`/escrows/${escrowId}`);
  }

  /**
   * Get the escrow linked to a job (accepts request_id or job_id).
   * GET /jobs/:id/escrow
   */
  getByJob(jobId: string): Promise<Escrow> {
    return this.request<Escrow>(`/jobs/${jobId}/escrow`);
  }

  /**
   * Create an escrow record for a job.
   * POST /escrows
   */
  create(input: CreateEscrowInput): Promise<Escrow> {
    return this.request<Escrow>("/escrows", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Mark escrow as funded (UNFUNDED → LOCKED).
   * POST /escrows/:id/fund
   */
  fund(escrowId: string, fundTxHash: string): Promise<Escrow> {
    return this.request<Escrow>(`/escrows/${escrowId}/fund`, {
      method: "POST",
      body: JSON.stringify({ fund_tx_hash: fundTxHash }),
    });
  }

  /**
   * Release escrow to provider (LOCKED → RELEASED).
   * POST /escrows/:id/release
   */
  release(escrowId: string, releaseTxHash: string): Promise<Escrow> {
    return this.request<Escrow>(`/escrows/${escrowId}/release`, {
      method: "POST",
      body: JSON.stringify({ release_tx_hash: releaseTxHash }),
    });
  }

  /**
   * Refund escrow to user (LOCKED | DISPUTED → REFUNDED).
   * POST /escrows/:id/refund
   */
  refund(escrowId: string, refundTxHash: string): Promise<Escrow> {
    return this.request<Escrow>(`/escrows/${escrowId}/refund`, {
      method: "POST",
      body: JSON.stringify({ refund_tx_hash: refundTxHash }),
    });
  }

  /**
   * Open a dispute on a locked escrow (LOCKED → DISPUTED).
   * POST /escrows/:id/dispute
   */
  dispute(escrowId: string): Promise<Escrow> {
    return this.request<Escrow>(`/escrows/${escrowId}/dispute`, {
      method: "POST",
    });
  }
}
