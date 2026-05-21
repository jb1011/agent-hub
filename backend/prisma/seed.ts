import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_REQUEST_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

async function main() {
  const provider = await prisma.provider.upsert({
    where: { request_id: DEMO_REQUEST_ID },
    create: {
      request_id: DEMO_REQUEST_ID,
      registry_provider_id: "1",
      name: "Demo Provider",
      description: "A demo provider for development",
      owner_wallet: "0x0000000000000000000000000000000000000001",
      payout_wallet: "0x0000000000000000000000000000000000000001",
      api_base_url: "https://demo.example.com",
      trust_level: "VERIFIED",
      service_type: "AI",
      price_usdc: 1.0,
      max_concurrent_jobs: 2,
      timeout_seconds: 60,
      status: "ACTIVE",
    },
    update: {},
  });

  console.log("Seeded:", {
    provider: { request_id: provider.request_id, name: provider.name },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
