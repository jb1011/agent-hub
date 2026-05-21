ALTER TABLE "Provider" ADD COLUMN "metadata_commitment" TEXT;

ALTER TABLE "Provider" ADD CONSTRAINT "Provider_metadata_commitment_bytes32_check"
  CHECK ("metadata_commitment" IS NULL OR "metadata_commitment" ~ '^0x[0-9a-fA-F]{64}$');

CREATE INDEX "Provider_owner_wallet_metadata_commitment_idx"
  ON "Provider"("owner_wallet", "metadata_commitment");
