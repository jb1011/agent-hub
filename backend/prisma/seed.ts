import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const provider = await prisma.provider.upsert({
    where: { provider_id: "1" },
    create: {
      provider_id: "1",
      name: "Demo Provider",
      description: "A demo service provider for development",
      owner_wallet: "0x0000000000000000000000000000000000000001",
      payout_wallet: "0x0000000000000000000000000000000000000001",
      api_base_url: "https://demo.example.com",
      trust_level: "VERIFIED",
      status: "ACTIVE",
    },
    update: {},
  });

  const service = await prisma.service.upsert({
    where: { service_id: "1" },
    create: {
      service_id: "1",
      provider_id: provider.provider_id,
      name: "Demo Text Processing",
      description: "A demo text processing service",
      service_type: "AI",
      endpoint_path: "/process",
      price_usdc: 1.0,
      max_concurrent_jobs: 2,
      timeout_seconds: 60,
      status: "ACTIVE",
    },
    update: {},
  });

  console.log("Seeded:", {
    provider: { id: provider.provider_id, name: provider.name },
    service: { id: service.service_id, name: service.name },
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
