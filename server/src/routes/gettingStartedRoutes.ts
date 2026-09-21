import type { FastifyInstance } from "fastify";
import type { Db } from "../db";
import { dismissGettingStarted, readGettingStartedDismissed } from "../accounts/gettingStartedDismissal";
import type { AuthorizeRouteInput } from "./routeShared";

/** A company-level preference: row presence is the only persisted state. */
export function registerGettingStartedRoutes(
  app: FastifyInstance,
  { db, authorize }: { db: Db; authorize: (input: AuthorizeRouteInput) => boolean },
): void {
  const accountExists = (accountId: string) => db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId);

  app.get("/api/accounts/:accountId/getting-started", async (req, reply) => {
    const { accountId } = req.params as { accountId: string };
    if (!authorize({ req, reply, accountId, action: "read" })) return;
    if (!accountExists(accountId)) return reply.code(404).send({ error: "Company not found." });
    return { dismissed: readGettingStartedDismissed(db, accountId) };
  });

  app.put("/api/accounts/:accountId/getting-started", async (req, reply) => {
    const { accountId } = req.params as { accountId: string };
    if (!authorize({ req, reply, accountId, action: "manageMembers" })) return;
    const body = req.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("dismissed" in body) ||
      body.dismissed !== true
    )
      return reply.code(400).send({ error: "dismissed must be true." });
    if (!accountExists(accountId)) return reply.code(404).send({ error: "Company not found." });
    dismissGettingStarted(db, accountId);
    return { dismissed: true };
  });
}
