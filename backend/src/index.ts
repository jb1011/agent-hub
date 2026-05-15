import Fastify from "fastify";
import cors from "@fastify/cors";
import { providersRoutes } from "./routes/providers.js";
import { servicesRoutes } from "./routes/services.js";
import { jobsRoutes } from "./routes/jobs.js";
import { escrowsRoutes } from "./routes/escrows.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

await app.register(providersRoutes);
await app.register(servicesRoutes);
await app.register(jobsRoutes);
await app.register(escrowsRoutes);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
