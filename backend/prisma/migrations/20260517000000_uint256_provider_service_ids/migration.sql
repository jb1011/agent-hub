-- Provider and service IDs are EVM uint256 values represented as canonical
-- decimal strings in the backend to avoid JavaScript integer precision loss.
ALTER TABLE "Provider"
  ADD CONSTRAINT "Provider_provider_id_uint256_check"
  CHECK (
    CASE
      WHEN "provider_id" ~ '^(0|[1-9][0-9]*)$'
      THEN "provider_id"::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
      ELSE false
    END
  ) NOT VALID;

ALTER TABLE "Service"
  ADD CONSTRAINT "Service_service_id_uint256_check"
  CHECK (
    CASE
      WHEN "service_id" ~ '^(0|[1-9][0-9]*)$'
      THEN "service_id"::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
      ELSE false
    END
  ) NOT VALID;

ALTER TABLE "Service"
  ADD CONSTRAINT "Service_provider_id_uint256_check"
  CHECK (
    CASE
      WHEN "provider_id" ~ '^(0|[1-9][0-9]*)$'
      THEN "provider_id"::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
      ELSE false
    END
  ) NOT VALID;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_service_id_uint256_check"
  CHECK (
    CASE
      WHEN "service_id" ~ '^(0|[1-9][0-9]*)$'
      THEN "service_id"::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
      ELSE false
    END
  ) NOT VALID;
