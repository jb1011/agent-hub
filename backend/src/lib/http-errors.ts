import { ZodError } from "zod";
import type { FastifyReply } from "fastify";

export function sendZodError(reply: FastifyReply, err: ZodError) {
  return reply.status(400).send({
    error: "validation_error",
    details: err.flatten(),
  });
}

export function notFound(reply: FastifyReply, message = "not_found") {
  return reply.status(404).send({ error: message });
}

export function conflict(reply: FastifyReply, message: string) {
  return reply.status(409).send({ error: message });
}

export function forbidden(reply: FastifyReply, message = "forbidden") {
  return reply.status(403).send({ error: message });
}
