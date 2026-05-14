import Fastify from "fastify";
import cors from "@fastify/cors";
import { usersRoutes } from "./routes/users.js";
import { agentsRoutes } from "./routes/agents.js";
import { jobsRoutes } from "./routes/jobs.js";
import { reviewsRoutes } from "./routes/reviews.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

await app.register(usersRoutes);
await app.register(agentsRoutes);
await app.register(jobsRoutes);
await app.register(reviewsRoutes);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
