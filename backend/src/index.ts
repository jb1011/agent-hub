import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from "@fastify/type-provider-zod";
import { providersRoutes } from "./routes/providers.js";
import {
  jobsRoutes,
  startNoDeliveryAttestationWorker,
  startReviewTimeoutSettlementWorker,
} from "./routes/jobs.js";
import { startEscrowJobCreatedListener } from "./listeners/escrow-job-created.js";
import { startRegistryProviderRegisteredListener } from "./listeners/registry-provider-registered.js";

const app = Fastify({ logger: true });

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(cors, { origin: true });

await app.register(swagger, {
  transform: jsonSchemaTransform,
  openapi: {
    openapi: "3.0.0",
    info: {
      title: "Skill Hub API",
      description:
        "REST API for the Skill Hub — a decentralised marketplace where AI agents discover and hire providers.",
      version: "0.1.0",
    },
    tags: [
      { name: "Providers", description: "AI provider registration and management" },
      { name: "Jobs", description: "Job lifecycle: creation, status transitions, and authorisations" },
    ],
  },
});

await app.register(swaggerUi, {
  routePrefix: "/docs",
  uiConfig: {
    docExpansion: "list",
    deepLinking: true,
  },
});

app.get("/health", { schema: { tags: ["Health"] } }, async () => ({ ok: true }));

await app.register(providersRoutes);
await app.register(jobsRoutes);

const escrowJobCreatedListener = startEscrowJobCreatedListener(app.log);
if (escrowJobCreatedListener) {
  app.addHook("onClose", async () => {
    await escrowJobCreatedListener.close();
  });
}

const registryProviderRegisteredListener = startRegistryProviderRegisteredListener(app.log);
if (registryProviderRegisteredListener) {
  app.addHook("onClose", async () => {
    await registryProviderRegisteredListener.close();
  });
}

const noDeliveryAttestationWorker = startNoDeliveryAttestationWorker(app.log);
if (noDeliveryAttestationWorker) {
  app.addHook("onClose", async () => {
    await noDeliveryAttestationWorker.close();
  });
}

const reviewTimeoutSettlementWorker = startReviewTimeoutSettlementWorker(app.log);
if (reviewTimeoutSettlementWorker) {
  app.addHook("onClose", async () => {
    await reviewTimeoutSettlementWorker.close();
  });
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
