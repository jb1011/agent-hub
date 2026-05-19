ALTER TABLE "Job"
  ADD COLUMN "delivery_attestation" JSONB,
  ADD COLUMN "no_delivery_attestation" JSONB,
  ADD COLUMN "no_delivery_attested_at" TIMESTAMP(3);
