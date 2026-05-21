-- Provider identity in metadataCommitment uses request_id (bytes32).
-- registry_provider_id keeps the on-chain uint256 provider id for escrow jobs.

ALTER TABLE "Provider" RENAME COLUMN "provider_id" TO "request_id";

ALTER TABLE "Provider" DROP CONSTRAINT IF EXISTS "Provider_provider_id_uint256_check";

ALTER TABLE "Provider" ADD COLUMN "registry_provider_id" TEXT;

UPDATE "Provider"
SET "registry_provider_id" = "request_id"
WHERE "request_id" ~ '^(0|[1-9][0-9]*)$';

CREATE OR REPLACE FUNCTION _agent_hub_uint256_to_bytes32(value numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  remaining numeric := value;
  hex_chars text := '0123456789abcdef';
  result text := '';
  digit int;
BEGIN
  IF remaining < 0
    OR remaining > 115792089237316195423570985008687907853269984665640564039457584007913129639935
  THEN
    RAISE EXCEPTION 'value is outside uint256 range: %', value;
  END IF;

  IF remaining = 0 THEN
    result := '0';
  END IF;

  WHILE remaining > 0 LOOP
    digit := mod(remaining, 16)::int;
    result := substr(hex_chars, digit + 1, 1) || result;
    remaining := trunc(remaining / 16);
  END LOOP;

  RETURN '0x' || lpad(result, 64, '0');
END;
$$;

UPDATE "Provider"
SET "request_id" = _agent_hub_uint256_to_bytes32("registry_provider_id"::numeric)
WHERE "registry_provider_id" IS NOT NULL;

CREATE UNIQUE INDEX "Provider_registry_provider_id_key" ON "Provider"("registry_provider_id");

ALTER TABLE "Provider" ADD CONSTRAINT "Provider_request_id_bytes32_check"
  CHECK ("request_id" ~ '^0x[0-9a-fA-F]{64}$');

ALTER TABLE "Provider" ADD CONSTRAINT "Provider_registry_provider_id_uint256_check"
  CHECK (
    "registry_provider_id" IS NULL
    OR (
      "registry_provider_id" ~ '^(0|[1-9][0-9]*)$'
      AND "registry_provider_id"::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
    )
  );

ALTER TABLE "Job" RENAME COLUMN "provider_id" TO "provider_request_id";

UPDATE "Job" AS j
SET "provider_request_id" = _agent_hub_uint256_to_bytes32(j."provider_request_id"::numeric)
WHERE j."provider_request_id" ~ '^(0|[1-9][0-9]*)$';

DROP INDEX IF EXISTS "Job_provider_id_idx";

CREATE INDEX "Job_provider_request_id_idx" ON "Job"("provider_request_id");

ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_provider_id_fkey";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_provider_id_uint256_check";

ALTER TABLE "Job" ADD CONSTRAINT "Job_provider_request_id_fkey"
  FOREIGN KEY ("provider_request_id") REFERENCES "Provider"("request_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP FUNCTION _agent_hub_uint256_to_bytes32(numeric);
