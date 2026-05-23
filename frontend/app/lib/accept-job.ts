import type {
  AcceptanceInput,
  AcceptanceRequestResult,
  OutputCommitmentInput,
} from "skillhub-sdk";

/** Default TTL for the user's JobAcceptance EIP-712 signature. */
export const ACCEPTANCE_EXPIRES_IN_SECONDS = 900;

export type Eip712TypedData = {
  domain: {
    name?: string;
    version?: string;
    chainId?: number | bigint;
    verifyingContract?: `0x${string}`;
    salt?: `0x${string}`;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  value: Record<string, unknown>;
};

export function parseAcceptanceTypedData(typedData: unknown): Eip712TypedData {
  if (
    typedData == null ||
    typeof typedData !== "object" ||
    !("domain" in typedData) ||
    !("types" in typedData) ||
    !("primaryType" in typedData) ||
    !("value" in typedData)
  ) {
    throw new Error("acceptance_typed_data_invalid");
  }
  return typedData as Eip712TypedData;
}

export function buildAcceptanceInput(
  outputCommitment: OutputCommitmentInput,
  acceptanceRequest: AcceptanceRequestResult,
  userSignature: string,
): AcceptanceInput {
  return {
    ...outputCommitment,
    output_commitment:
      acceptanceRequest.settle_with_user_signature_args.output_commitment,
    expires_at: acceptanceRequest.settle_with_user_signature_args.expires_at,
    user_signature: userSignature,
  };
}
