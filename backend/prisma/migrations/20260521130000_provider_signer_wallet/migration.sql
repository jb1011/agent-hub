ALTER TABLE "Provider" ADD COLUMN "signer_wallet" TEXT;

UPDATE "Provider"
SET "signer_wallet" = "owner_wallet"
WHERE "signer_wallet" IS NULL;

ALTER TABLE "Provider" ALTER COLUMN "signer_wallet" SET NOT NULL;
