import type { FastifyInstance } from "fastify";
import type { Db } from "../db";
import { dismissGettingStarted, readGettingStartedDismissed } from "../accounts/gettingStartedDismissal";
import { REPLY_ERRORS } from "./replyErrors";
import type { AuthorizeRouteInput, ParseResult } from "./routeShared";

interface GettingStartedRoute {
  Params: { accountId: string };
}

/** The only accepted body is exactly `{ dismissed: true }`. */
function parseDismissalBody(body: unknown): ParseResult<true, string> {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("dismissed" in body) ||
    body.dismissed !== true
  )
    return { kind: "invalid", failure: REPLY_ERRORS.gettingStartedDismissedInvalid };
  return { kind: "parsed", value: true };
}

/** A company-level preference: row presence is the only persisted state. */
export function registerGettingStartedRoutes(
  app: FastifyInstance,
  { db, authorize }: { db: Db; authorize: (input: AuthorizeRouteInput) => boolean },
): void {
  const accountExists = (accountId: string) => db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId);

  app.get<GettingStartedRoute>("/api/accounts/:accountId/getting-started", async (req, reply) => {
    const { accountId } = req.params;
    if (!authorize({ req, reply, accountId, action: "read" })) return;
    if (!accountExists(accountId)) return reply.code(404).send({ error: REPLY_ERRORS.companyNotFound });
    return reply.code(200).send({ dismissed: readGettingStartedDismissed(db, accountId) });
  });

  app.put<GettingStartedRoute>("/api/accounts/:accountId/getting-started", async (req, reply) => {
    const { accountId } = req.params;
    if (!authorize({ req, reply, accountId, action: "manageMembers" })) return;
    const parsed = parseDismissalBody(req.body);
    if (parsed.kind === "invalid") return reply.code(400).send({ error: parsed.failure });
    if (!accountExists(accountId)) return reply.code(404).send({ error: REPLY_ERRORS.companyNotFound });
    dismissGettingStarted(db, accountId);
    return reply.code(200).send({ dismissed: true });
  });
}
