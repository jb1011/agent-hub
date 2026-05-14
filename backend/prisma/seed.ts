import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const buyer = await prisma.user.upsert({
    where: { email: "demo-buyer@example.com" },
    create: {
      email: "demo-buyer@example.com",
      displayName: "Demo Buyer",
      role: "user",
    },
    update: { displayName: "Demo Buyer" },
  });

  const builder = await prisma.user.upsert({
    where: { email: "demo-builder@example.com" },
    create: {
      email: "demo-builder@example.com",
      displayName: "Demo Builder",
      role: "builder",
    },
    update: { displayName: "Demo Builder", role: "builder" },
  });

  console.log("Seeded users:", {
    buyer: { id: buyer.id, email: buyer.email, role: buyer.role },
    builder: { id: builder.id, email: builder.email, role: builder.role },
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
