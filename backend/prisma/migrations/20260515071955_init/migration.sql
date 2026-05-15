-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('REGISTERED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('UNVERIFIED', 'VERIFIED', 'CERTIFIED', 'HOSTED');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('REGISTERED', 'ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('CREATED', 'FUNDED', 'RUNNING', 'SUBMITTED', 'ACCEPTED', 'SETTLED', 'FAILED', 'EXPIRED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('UNFUNDED', 'LOCKED', 'RELEASED', 'REFUNDED', 'DISPUTED');

-- CreateTable
CREATE TABLE "Provider" (
    "provider_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProviderStatus" NOT NULL DEFAULT 'REGISTERED',
    "owner_wallet" TEXT NOT NULL,
    "payout_wallet" TEXT NOT NULL,
    "api_base_url" TEXT NOT NULL,
    "trust_level" "TrustLevel" NOT NULL DEFAULT 'UNVERIFIED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "Service" (
    "service_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "service_type" TEXT NOT NULL,
    "endpoint_path" TEXT NOT NULL,
    "input_schema" JSONB,
    "output_schema" JSONB,
    "price_usdc" DECIMAL(18,6) NOT NULL,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 300,
    "status" "ServiceStatus" NOT NULL DEFAULT 'REGISTERED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("service_id")
);

-- CreateTable
CREATE TABLE "Job" (
    "job_id" TEXT NOT NULL,
    "user_wallet" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'CREATED',
    "input_uri" TEXT,
    "input_hash" TEXT,
    "output_uri" TEXT,
    "output_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "funded_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "work_deadline" TIMESTAMP(3),
    "review_deadline" TIMESTAMP(3),
    "error_message" TEXT,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "Escrow" (
    "escrow_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "token_address" TEXT NOT NULL,
    "escrow_contract" TEXT NOT NULL,
    "amount_usdc" DECIMAL(18,6) NOT NULL,
    "platform_fee_usdc" DECIMAL(18,6) NOT NULL,
    "provider_payout_usdc" DECIMAL(18,6) NOT NULL,
    "escrow_status" "EscrowStatus" NOT NULL DEFAULT 'UNFUNDED',
    "fund_tx_hash" TEXT,
    "release_tx_hash" TEXT,
    "refund_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escrow_pkey" PRIMARY KEY ("escrow_id")
);

-- CreateIndex
CREATE INDEX "Provider_status_idx" ON "Provider"("status");

-- CreateIndex
CREATE INDEX "Provider_owner_wallet_idx" ON "Provider"("owner_wallet");

-- CreateIndex
CREATE INDEX "Service_provider_id_status_idx" ON "Service"("provider_id", "status");

-- CreateIndex
CREATE INDEX "Job_user_wallet_status_idx" ON "Job"("user_wallet", "status");

-- CreateIndex
CREATE INDEX "Job_service_id_idx" ON "Job"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_job_id_key" ON "Escrow"("job_id");

-- CreateIndex
CREATE INDEX "Escrow_escrow_status_idx" ON "Escrow"("escrow_status");

-- CreateIndex
CREATE INDEX "Escrow_job_id_idx" ON "Escrow"("job_id");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "Provider"("provider_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "Service"("service_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("job_id") ON DELETE RESTRICT ON UPDATE CASCADE;
