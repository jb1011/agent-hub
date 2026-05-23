CREATE TABLE "provider_request_nonces" (
    "id" TEXT NOT NULL,
    "provider_request_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "provider_request_nonces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_request_nonces_provider_request_id_nonce_key"
    ON "provider_request_nonces"("provider_request_id", "nonce");

CREATE INDEX "provider_request_nonces_expires_at_idx"
    ON "provider_request_nonces"("expires_at");

ALTER TABLE "provider_request_nonces"
    ADD CONSTRAINT "provider_request_nonces_provider_request_id_fkey"
    FOREIGN KEY ("provider_request_id") REFERENCES "Provider"("request_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
