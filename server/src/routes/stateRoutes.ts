import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { CommandIdentity, Role } from "@capacitylens/shared/account/types";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { secretTokenMatches, type Auth, type AuthMode } from "../auth";
import type { Db } from "../db";
import { insertRow, listAccountSummaries, loadState } from "../db";
import type { LocalAccountFlows } from "../accounts/localAccountFlows";
import type { MasqueradeRegistry } from "../masqueradeRegistry";
import type { TenantStore } from "../tenantStore";
import { acceptedFieldNames, sanitizeWrite, validateWrite } from "../validate";
import { readSliceVisibility, visibilityForRole } from "../fieldPolicy";
import { enqueueAudit } from "../auditOutbox";
import { canonicalAccountProductPayload } from "./accountEntityRoutes";
import { ALL_FIELDS_VISIBLE, type AuthorizeRoute } from "./routeShared";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";

type StateAccountAdministration = AccountAdminPort & {
  roleForPrincipalInWorkspace(principalId: string, workspaceId: string): Role | null;
};

/** Stable server-owned id for an omitted workspace id. A retry carrying the same command must
 * address the same workspace rather than minting a new id and conflicting with its own ledger. */
function generatedWorkspaceId(commandId: string): string {
  return `w_${createHash("sha256")
    .update("capacitylens-workspace-command\0")
    .update(commandId)
    .digest("base64url")
    .slice(0, 21)}`;
}

export interface StateRouteDependencies {
  section: "read" | "org";
  db: Db;
  store: TenantStore;
  authMode: AuthMode;
  auth: Auth | null;
  multiAccount: boolean;
  bootstrapToken?: string;
  accountAdminPort: StateAccountAdministration;
  accountFlows: LocalAccountFlows;
  masquerades: MasqueradeRegistry;
  authorize: AuthorizeRoute;
  resolveEffectiveRole: (req: FastifyRequest, accountId: string) => { role: Role | null; ended: boolean };
  accountCommand: (req: FastifyRequest) => CommandIdentity;
  accountFail: (reply: FastifyReply, error: unknown) => FastifyReply;
  sendFail: (reply: FastifyReply, error: unknown) => FastifyReply;
  drainProductAudit: (reply: FastifyReply) => boolean;
}

export function registerStateRoutes(app: FastifyInstance, dependencies: StateRouteDependencies): void {
  const {
    db,
    store,
    authMode,
    auth,
    multiAccount,
    bootstrapToken,
    accountAdminPort,
    accountFlows,
    masquerades,
    authorize,
    resolveEffectiveRole,
    accountCommand,
    accountFail,
    sendFail,
    drainProductAudit,
  } = dependencies;

  if (dependencies.section === "read") {
    // The login → account list that drives the AccountPicker (P1.13). OFF mode is trusted-local:
    // EVERY account is accessible, so return all summaries with NO membership gate — branch on
    // authMode === 'off' BEFORE touching membership (the OFF guarantee). Auth-on returns ONLY the
    // caller's memberships through AccountAdminPort. Returns AccountSummary[] = [{ id, name, role }].
    app.get("/api/accounts", async (req, reply) => {
      if (authMode === "off") {
        // No membership in off mode: every account is visible. Map to the same AccountSummary shape
        // The account port maps to ({ id, name, role }) so the auth-on / auth-off shapes are identical on
        // the wire. The role is 'owner' — the trusted-local full-access sentinel: OFF is byte-identical
        // to today's no-login deploy, so the client's pure `can('owner', …)` keeps OFF fully editable
        // (and a Viewer read-only mode is reachable ONLY auth-on, where a real membership role exists).
        const accounts = listAccountSummaries(db);
        return accounts.map((account) => ({
          id: account.id,
          name: account.name,
          role: "owner" as const,
        }));
      }
      const memberships = await accountAdminPort.listWorkspacesForPrincipal({
        principalId: req.accountActor!.principalId,
      });
      // Revalidate the projected account even when the caller's membership was removed and the
      // account therefore no longer appears in `memberships`. The triggering request must end with
      // MASQUERADE_ENDED, never silently return another-account data under a stale client phase.
      const activeRecord = req.session ? masquerades.peek(req.session.id) : null;
      let projectedRole: ReturnType<typeof accountAdminPort.roleForPrincipalInWorkspace> = null;
      if (activeRecord) {
        const activeResolution = resolveEffectiveRole(req, activeRecord.accountId);
        if (activeResolution.ended) {
          return reply.code(403).send({ error: "Masquerade ended.", code: MASQUERADE_ERROR_CODES.ended });
        }
        projectedRole = activeResolution.role;
      }
      return memberships.map((membership) => ({
        id: membership.workspaceId,
        name: membership.workspaceName,
        role: membership.workspaceId === activeRecord?.accountId ? (projectedRole ?? membership.role) : membership.role,
      }));
    });

    // Whole-state read backs the client's PersistenceAdapter.loadAll(). Only WRITES are entity-level;
    // reads stay whole-tree so hydration is one round-trip.
    //
    // P1.4: when `?accountId=` is PRESENT, return that account's scoped slice via the TenantStore
    // (OFF mode: no gate — trusted-local; auth-on: a thin membership-existence guard — a null role
    // null ⇒ 403, so auth-on can't cross-tenant-read; the richer per-action can() gate is P1.5).
    app.get("/api/state", (req, reply) => {
      const { accountId } = req.query as { accountId?: string };
      if (accountId !== undefined) {
        if (typeof accountId !== "string" || accountId.length === 0) {
          return reply.code(400).send({ error: "accountId must be a non-empty string." });
        }
        // Refuse a cross-tenant read before any data leaves the DB. The authorize seam is the
        // single source of truth: OFF mode short-circuits to allow-all (trusted-local), auth-on
        // requires membership (read = any member, via can()) and 403s a non-member.
        const authorization = authorize(req, reply, accountId, "read");
        if (!authorization) return;
        // P1.6 field-level redaction: the time-off `note` is owner/admin-only. Decide visibility from
        // the caller's role and redact it SERVER-SIDE so it never serializes for an Editor/Viewer.
        // OFF mode = trusted-local ⇒ include. Auth-on: owner/admin include, editor/viewer omit.
        // The port role is non-null here (authorize('read') already proved membership); the `role !==
        // null` guard is belt-and-braces / fail-closed (an unexpected null omits the note, never leaks).
        // Derive the export/read include flags from the SAME GATED_FIELD_POLICIES predicates that
        // drive the write-pin and read-echo, so the three can never disagree. OFF is trusted-local ⇒
        // include everything; otherwise each gated field is included iff the role may see it.
        const vis = authMode === "off" ? ALL_FIELDS_VISIBLE : visibilityForRole(authorization.role);
        // P2.5a admin "Archived & deleted" read. `?includeInactive=1` asks for the FULL slice
        // (archived + soft-deleted rows retained), which is privileged: it is gated at the SAME tier as
        // purge (admin+ with a fresh session) — the lifecycle-management tier — so an editor/viewer or
        // stale privileged session cannot pull tombstones. OFF mode is trusted-local ⇒ always allowed.
        // A refusal is explicit rather than silently falling back to the active-only read.
        //
        // P2.6 COMPLETE PER-TENANT EXPORT. This same admin/'purge'-gated `?includeInactive=1` read IS
        // the roadmap's "complete per-tenant backup": exactly ONE account's slice (the accountId guard
        // above), retaining archived + soft-deleted rows so nothing is silently dropped from the backup
        // — UNLIKE the client's active-only "Export JSON" (P2.4), which projects via activeOnly and so
        // omits tombstones. The server-control tables (account_members / invites / Better Auth user|
        // session|account) are STRUCTURALLY excluded: readSlice only ever reads `accounts` + the scoped
        // tables, never the control plane, so membership/invite secrets/PII can never ride the export.
        // The slice composition is locked by app.export.test.ts.
        const includeInactive = (req.query as { includeInactive?: string }).includeInactive;
        if (includeInactive !== undefined && includeInactive !== "1") {
          return reply.code(400).send({ error: "includeInactive must be the literal value 1 when present." });
        }
        const wantsInactive = includeInactive === "1";
        if (wantsInactive && !authorize(req, reply, accountId, "purge")) return;
        // P2.4: the NORMAL app read HIDES archived/soft-deleted resources/clients/projects — pass
        // includeInactive:false so readSlice drops them server-side (the same rule the client views
        // apply via useActiveScopedData). The P2.5a admin read passes true to retain them.
        return store.readSlice(accountId, {
          ...readSliceVisibility(vis),
          includeInactive: wantsInactive,
        });
      }
      // No ?accountId=. The auth-on cross-tenant whole-read is now CLOSED (P1.13 — the P1.4
      // carry-forward): a logged-in user must hydrate PER ACCOUNT via ?accountId= (the client picker
      // → GET /api/accounts → GET /api/state?accountId=). Returning the whole DB to any authed user
      // was a tenant-isolation leak; 400 it. OFF mode is trusted-local, so it RETAINS the whole read
      // (db-helpers, the OFF db-backed e2e, and the OFF app.accounts tests all rely on it). The client
      // adapter treats this 400 on the NO-ARG read as "hydrate empty, show the picker" (see
      // ServerSyncAdapter.loadAll), so a no-arg bootstrap in auth-on lands on the picker, not an error.
      if (authMode !== "off") {
        return reply.code(400).send({ error: "accountId is required." });
      }
      // OFF: trusted-local whole read RETAINED. (P1.6 note: this whole read does NOT redact the
      // time-off `note` — fine, OFF is trusted-local and includes it everywhere.)
      return loadState(db);
    });
    return;
  }

  // Constrained org-creation (P1.8): the ATOMIC "create a usable account" path, and — with auth
  // on — the ONLY account-create path: the generic vectors (POST /api/accounts, PUT-as-create,
  // batch PUT-as-create) now refuse auth-on creates with a 403 directing here (see
  // ACCOUNT_CREATE_CLOSED_MESSAGE; they stay open in OFF mode for the trusted-local client).
  // Unlike those bare row writes, /api/orgs ALSO mints the account's built-in Internal client and
  // makes the caller its Owner, in ONE transaction.
  //
  // AUTHORIZATION is evaluated by AccountAdminPort INSIDE the coordinator's transaction while
  // the application-wide provisioning lock is held. That closes the check/write race between two
  // concurrent first-company requests while keeping policy out of the coordinator itself. Two
  // separate conditions must pass:
  //
  //   (1) The single-company cap (WHETHER a new company may exist at all; see
  //       AppOptions.multiAccount). It is evaluated first so a denied caller sees the actionable
  //       cap message. OFF mode and the bootstrap token do not bypass it.
  //
  //   (2) WHO may create it once the cap permits. AccountAdminPort applies the same four arms that
  //       /api/auth/me mirrors for its advisory canCreateAccount flag. Allowed iff ANY of:
  //   (1) ZERO accounts exist — first-run bootstrap (anyone may create the very first org; this
  //       is also the only case GATE 0 lets through by default, so it's the common path).
  //   (2) OFF mode (trusted-local) — mirrors the authorize() OFF no-op; req.user is DEMO_USER.
  //   (3) auth-on: the caller is an ACTIVE Owner/Admin of SOME existing account (can(role,
  //       'manageMembers') = admin-tier) with fresh administrative assurance — an existing
  //       operator may provision more orgs after the same step-up required for other Owner grants.
  //   (4) a valid bootstrap token in the `x-capacitylens-bootstrap-token` header (opts.bootstrapToken,
  //       env CAPACITYLENS_BOOTSTRAP_TOKEN, OFF by default — disabled when unset/empty).
  // Otherwise 403 — the acceptance criterion: a STRANGER cannot create an org once any account
  // exists, absent a bootstrap token. The gate runs in auth-on AND off; in off mode (1)/(2) already
  // allow, so the token/membership branches are moot there.
  app.post("/api/orgs", async (req, reply) => {
    // Build a VALID account row from the body (name required; colour repaired; junk schedulingMode
    // dropped) via the SAME sanitize/validate the generic account create uses — so /api/orgs can't
    // persist a row the generic path would reject. The id is generated server-side when the body
    // omits one (the org-create caller need not mint it, unlike the entity sync path); a provided id
    // is accepted and validated like any other write.
    try {
      if (
        authMode === "sso" &&
        (auth?.strictProvider?.id === undefined || req.authenticationProviderId !== auth.strictProvider.id)
      ) {
        return accountFail(
          reply,
          new AccountContractError({
            code: "FORBIDDEN",
            message: "Sign in with the required SSO provider before creating a company.",
            retryable: false,
          }),
        );
      }
      const command = accountCommand(req);
      const bootstrapAuthorized = secretTokenMatches(bootstrapToken, req.headers["x-capacitylens-bootstrap-token"]);
      const now = new Date().toISOString();
      const id =
        typeof (req.body as { id?: unknown })?.id === "string" && (req.body as { id: string }).id.trim() !== ""
          ? (req.body as { id: string }).id
          : generatedWorkspaceId(command.commandId);
      const accountRow = sanitizeWrite("accounts", {
        ...(req.body as Record<string, unknown>),
        id,
        createdAt: now,
        updatedAt: now,
      });
      // Server timestamps are result data, not caller intent. Excluding them from the command
      // digest lets an identical retry replay the first committed row after wall time advances.
      const canonicalAccountRow = canonicalAccountProductPayload(accountRow);
      const provisioned = await accountFlows.provisionWorkspace({
        actor: req.accountActor!,
        workspaceId: id,
        joinedAt: now,
        command,
        multiWorkspace: multiAccount,
        bootstrapAuthorized,
        canonicalProductPayload: canonicalAccountRow,
        provisionProductData: () => {
          // Finding 9: accounts validation is name-only (validate.ts), so it needs no cross-table
          // data — a full-DB loadState here was pure waste. Scope to this account's (empty) slice.
          validateWrite(emptyAppData(), "accounts", accountRow);
          insertRow(db, "accounts", accountRow);
          insertRow(db, "clients", buildInternalClient(id, now) as unknown as Record<string, unknown>);
          enqueueAudit(db, {
            ts: String(accountRow.createdAt),
            userId: req.user!.id,
            accountId: id,
            action: "create",
            entity: "accounts",
            id,
            changedFields: acceptedFieldNames("accounts", accountRow),
          });
          return accountRow;
        },
      });
      if (!provisioned.replayed) {
        drainProductAudit(reply);
      }
      return reply.code(201).send(provisioned.product);
    } catch (err) {
      return err instanceof AccountContractError ? accountFail(reply, err) : sendFail(reply, err);
    }
  });
}
