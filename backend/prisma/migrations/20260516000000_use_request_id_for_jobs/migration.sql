-- Keep the backend-generated ID as request_id and reserve job_id for the
-- on-chain job ID emitted by the escrow contract.
ALTER TABLE "Escrow" DROP CONSTRAINT IF EXISTS "Escrow_job_id_fkey";

DROP INDEX IF EXISTS "Escrow_job_id_key";
DROP INDEX IF EXISTS "Escrow_job_id_idx";

ALTER TABLE "Job" ADD COLUMN "request_id" TEXT;
UPDATE "Job" SET "request_id" = "job_id";

ALTER TABLE "Job" DROP CONSTRAINT "Job_pkey";
ALTER TABLE "Job" ALTER COLUMN "request_id" SET NOT NULL;
ALTER TABLE "Job" ALTER COLUMN "job_id" DROP NOT NULL;
UPDATE "Job" SET "job_id" = NULL;
ALTER TABLE "Job" ADD CONSTRAINT "Job_pkey" PRIMARY KEY ("request_id");

CREATE UNIQUE INDEX "Job_job_id_key" ON "Job"("job_id");

ALTER TABLE "Escrow" RENAME COLUMN "job_id" TO "request_id";

CREATE UNIQUE INDEX "Escrow_request_id_key" ON "Escrow"("request_id");
CREATE INDEX "Escrow_request_id_idx" ON "Escrow"("request_id");

ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "Job"("request_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Job" DROP COLUMN IF EXISTS "onchain_job_id";
