import type { FastifyInstance, FastifyReply } from "fastify";
import type { Role } from "@capacitylens/shared/account/types";
import { buildExampleCompany, countExampleRows } from "@capacitylens/shared/data/exampleCompany";
import { can } from "@capacitylens/shared/domain/access";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { KeyedOperationLock } from "../accounts/KeyedOperationLock";
import type { AuditRecord } from "../audit";
import type { AccountMode } from "../auth";
import { insertRow, type Db } from "../db";
import type { Row } from "../rowCodec";
import { SCOPED_ORDER } from "../tables";
import type { AccountStore } from "../accountStore";
import { REPLY_ERRORS } from "./replyErrors";
import { NO_REPROMPT, type AuthorizeRouteInput } from "./routeShared";

class CompanyNotEmptyError extends Error {
  constructor() {
    super(REPLY_ERRORS.exampleDataCompanyNotEmpty);
    this.name = "CompanyNotEmptyError";
  }
}

export interface ExampleDataRouteDependencies {
  db: Db;
  store: AccountStore;
  authMode: AccountMode;
  accountAdminPort: { roleForPrincipalInWorkspace(principalId: string, workspaceId: string): Role | null };
  accountLock: KeyedOperationLock;
  authorize: (input: AuthorizeRouteInput) => boolean;
  commitProductAudit: (reply: FastifyReply, record: AuditRecord, mutation: () => void) => boolean;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
}

/** The built-in Internal client is infrastructure every company has, so it does not count. */
function holdsWork(slice: AppData): boolean {
  return (
    slice.resources.length > 0 ||
    slice.clients.some((client) => client.builtin !== true) ||
    slice.projects.length > 0 ||
    slice.allocations.length > 0
  );
}

function stillMayAdd(userId: string, accountId: string, dependencies: ExampleDataRouteDependencies): boolean {
  if (dependencies.authMode === "off") return true;
  const role = dependencies.accountAdminPort.roleForPrincipalInWorkspace(userId, accountId);
  return role !== null && can(role, "manageMembers");
}

export function registerExampleDataRoutes(app: FastifyInstance, dependencies: ExampleDataRouteDependencies): void {
  const { db, store, accountLock, authorize, commitProductAudit, fail } = dependencies;

  // Adds one small ordinary company's worth of rows to an empty company. Unlike /api/import this
  // never replaces anything, so it needs the company's Owner or Admin rather than the Owner and no
  // fresh sign-in. The emptiness rule is checked inside the same write transaction as the insert,
  // so two concurrent calls cannot both succeed.
  app.post<{ Params: { accountId: string } }>("/api/accounts/:accountId/example-data", async (req, reply) => {
    const { accountId } = req.params;
    if (!authorize({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT })) return;
    const user = req.user;
    if (user === null) return fail(reply, new Error("Authenticated example-data request has no user."));
    try {
      const account = store.readFullSlice(accountId).accounts[0];
      if (account === undefined) return reply.code(404).send({ error: REPLY_ERRORS.companyNotFound });
      const data = buildExampleCompany({
        accountId,
        referenceDate: todayISO(account.timezone),
        weekStartsOn: account.weekStartsOn ?? 1,
      });
      const record: AuditRecord = {
        ts: new Date().toISOString(),
        userId: user.id,
        accountId,
        action: "exampleData",
        entity: "account",
        id: accountId,
        changedFields: Object.keys(data),
      };
      const committed = await accountLock.withKeys([user.id, `workspace:${accountId}`], () => {
        if (!stillMayAdd(user.id, accountId, dependencies)) return undefined;
        return commitProductAudit(reply, record, () => {
          if (holdsWork(store.readFullSlice(accountId))) throw new CompanyNotEmptyError();
          const rows = data as unknown as Record<string, Row[]>;
          for (const table of SCOPED_ORDER) for (const row of rows[table] ?? []) insertRow(db, table, row);
        });
      });
      if (committed === undefined) return reply.code(403).send({ error: REPLY_ERRORS.forbidden });
      return reply.code(201).send({ added: countExampleRows(data) });
    } catch (error) {
      if (error instanceof CompanyNotEmptyError) {
        return reply
          .code(409)
          .send({ error: REPLY_ERRORS.exampleDataCompanyNotEmpty, code: "EXAMPLE_DATA_COMPANY_NOT_EMPTY" });
      }
      return fail(reply, error);
    }
  });
}
