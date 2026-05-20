ALTER TABLE "Provider"
  ADD COLUMN "service_type" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "input_schema" JSONB,
  ADD COLUMN "output_schema" JSONB,
  ADD COLUMN "price_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "max_concurrent_jobs" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "timeout_seconds" INTEGER NOT NULL DEFAULT 300;

UPDATE "Provider" p
SET
  "service_type" = s."service_type",
  "input_schema" = s."input_schema",
  "output_schema" = s."output_schema",
  "price_usdc" = s."price_usdc",
  "max_concurrent_jobs" = s."max_concurrent_jobs",
  "timeout_seconds" = s."timeout_seconds"
FROM (
  SELECT DISTINCT ON ("provider_id")
    "provider_id",
    "service_type",
    "input_schema",
    "output_schema",
    "price_usdc",
    "max_concurrent_jobs",
    "timeout_seconds"
  FROM "Service"
  ORDER BY "provider_id", "created_at" DESC
) s
WHERE p."provider_id" = s."provider_id";

ALTER TABLE "Provider"
  ALTER COLUMN "service_type" DROP DEFAULT,
  ALTER COLUMN "price_usdc" DROP DEFAULT,
  ALTER COLUMN "max_concurrent_jobs" DROP DEFAULT;

ALTER TABLE "Job" ADD COLUMN "provider_id" TEXT;

UPDATE "Job" j
SET "provider_id" = s."provider_id"
FROM "Service" s
WHERE j."service_id" = s."service_id";

ALTER TABLE "Job" ALTER COLUMN "provider_id" SET NOT NULL;

ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_service_id_fkey";
DROP INDEX IF EXISTS "Job_service_id_idx";

ALTER TABLE "Job" DROP COLUMN "service_id";

DROP TABLE "Service";
DROP TYPE "ServiceStatus";

CREATE INDEX "Job_provider_id_idx" ON "Job"("provider_id");

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "Provider"("provider_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_provider_id_uint256_check"
  CHECK (
    "provider_id" ~ '^(0|[1-9][0-9]*)$'
    AND (
      CASE
        WHEN "provider_id" ~ '^(0|[1-9][0-9]*)$'
        THEN "provider_id"::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
        ELSE false
      END
    )
  );
