import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountMode } from "../auth";
import type { Db } from "../db";
import { insertAll, wipe } from "../db";
import { seed } from "@capacitylens/shared/data/seed";
import { tx } from "../txn";
import { REPLY_ERRORS } from "./replyErrors";

/** Dependencies for the installation-wide trusted-local test reset endpoint. */
export interface TestResetRouteDependencies {
  db: Db;
  authMode: AccountMode;
  allowReset: boolean;
}

function isResetSeedRequested(body: unknown): boolean {
  return body !== null && typeof body === "object" && "seed" in body && Boolean(body.seed);
}

function resetState(req: FastifyRequest, reply: FastifyReply, dependencies: TestResetRouteDependencies): FastifyReply {
  if (!dependencies.allowReset || dependencies.authMode !== "off") {
    return reply.code(403).send({ error: REPLY_ERRORS.resetDisabled });
  }
  tx(dependencies.db, () => {
    wipe(dependencies.db);
    if (isResetSeedRequested(req.body)) insertAll(dependencies.db, seed());
  });
  return reply.code(200).send({ ok: true });
}

/** Registers the auth-off installation reset used by local tests. */
export function registerTestResetRoutes(app: FastifyInstance, dependencies: TestResetRouteDependencies): void {
  // Authenticated identities have tenant-scoped authority and can never erase an installation.
  app.post("/api/test/reset", (req, reply) => resetState(req, reply, dependencies));
}
