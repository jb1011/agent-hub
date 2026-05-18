ALTER TABLE "Service"
  ADD COLUMN "max_concurrent_jobs" INTEGER;

UPDATE "Service"
  SET "max_concurrent_jobs" = 1
  WHERE "max_concurrent_jobs" IS NULL;

ALTER TABLE "Service"
  ALTER COLUMN "max_concurrent_jobs" SET NOT NULL,
  ADD CONSTRAINT "Service_max_concurrent_jobs_positive_check"
    CHECK ("max_concurrent_jobs" > 0);
