import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AccountAdminPort,
  AccountFlows,
  AccountFlowOperation,
  IdentityPort,
} from "@capacitylens/shared/account/ports";
import type { AccountMode, CommandIdentity } from "@capacitylens/shared/account/types";
import { isAccountRole, isMembershipStatus } from "@capacitylens/shared/account/types";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import type { Action } from "@capacitylens/shared/domain/access";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { cleanText } from "@capacitylens/shared/lib/strings";
import type { AuditRecord } from "../audit";
import { wasAccountCommandReplayed } from "./commands";

const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

/** Parse the route's narrow UTC-instant format without accepting Date.parse calendar rollover. */
function parseStrictIsoInstant(value: string): number | null {
  const match = ISO_INSTANT_RE.exec(value);
  if (!match) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;

  const [, year, month, day, hour, minute, second, fraction] = match;
  const instant = new Date(parsed);
  const milliseconds = Number((fraction ?? "").padEnd(3, "0") || "0");
  if (
    instant.getUTCFullYear() !== Number(year) ||
    instant.getUTCMonth() + 1 !== Number(month) ||
    instant.getUTCDate() !== Number(day) ||
    instant.getUTCHours() !== Number(hour) ||
    instant.getUTCMinutes() !== Number(minute) ||
    instant.getUTCSeconds() !== Number(second) ||
    instant.getUTCMilliseconds() !== milliseconds
  )
    return null;
  return parsed;
}

export interface AccountRouteDependencies {
  authMode: AccountMode;
  authenticationConfigured: boolean;
  /** SSO-only invitation acceptance must arrive through this provider so a new membership cannot
   * make the installation fail its next strict-provider readiness check. */
  requiredSsoProviderId: string | null;
  administration: AccountAdminPort;
  identity: IdentityPort;
  flows: AccountFlows;
  authorize(request: FastifyRequest, reply: FastifyReply, workspaceId: string, action: Action): boolean;
  command(request: FastifyRequest): CommandIdentity;
  audit(reply: FastifyReply, record: AuditRecord): void;
  fail(reply: FastifyReply, error: unknown): unknown;
}

/**
 * Register the account-administration HTTP adapter.
 *
 * This module owns transport validation and response compatibility only. Policy stays in the
 * account-administration port/policy module; cross-port ordering stays in AccountFlows.
 */
export function registerAccountRoutes(app: FastifyInstance, dependencies: AccountRouteDependencies): void {
  const {
    authMode,
    authenticationConfigured,
    requiredSsoProviderId,
    administration: accountAdminPort,
    identity: identityPort,
    flows: accountFlows,
    authorize,
    command: accountCommand,
    audit,
    fail: accountFail,
  } = dependencies;
  const isKnownRole = isAccountRole;
  const validationFailed = (message: string) =>
    new AccountContractError({ code: "VALIDATION_FAILED", message, retryable: false });
  const memberNotFound = (command: CommandIdentity) =>
    new AccountContractError({
      code: "NOT_FOUND",
      message: "Not a member of this account.",
      retryable: false,
      commandId: command.commandId,
    });
  const isFlowOperation = (value: unknown): value is AccountFlowOperation =>
    value === "invite-password-signup" ||
    value === "password-reset" ||
    value === "session-revocation" ||
    value === "workspace-provisioning" ||
    value === "workspace-erasure";

  // A command id plus its independent idempotency key is a high-entropy reconciliation bearer.
  // The response contains status and redacted repair coordinates only; never tenant or identity data.
  app.post("/api/account-commands/reconcile", async (req, reply) => {
    const body = (req.body ?? {}) as {
      commandId?: unknown;
      operation?: unknown;
      idempotencyKey?: unknown;
    };
    if (
      typeof body.commandId !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(body.commandId) ||
      typeof body.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotencyKey) ||
      !isFlowOperation(body.operation)
    )
      return reply.code(400).send({
        error: "A valid command, idempotency key, and operation are required.",
      });
    try {
      const outcome = await accountFlows.reconcileCommand({
        command: {
          commandId: body.commandId,
          idempotencyKey: body.idempotencyKey,
        },
        operation: body.operation,
      });
      if (!outcome) return reply.code(404).send({ error: "Command not found." });
      // The public ceremony is intentionally only a status oracle. Full repair coordinates stay in
      // the operator-only database/CLI path; possession of browser reconciliation bearers must not
      // disclose workspace, principal, provisional-principal, or reset-ceremony identifiers.
      return reply.code(200).send(
        outcome.status === "reconciliation-required"
          ? {
              ...outcome,
              repair: {
                kind: outcome.repair.kind,
                workspaceId: null,
                targetPrincipalId: null,
                provisionalPrincipalId: null,
                ceremonyId: null,
              },
            }
          : outcome,
      );
    } catch (error) {
      return accountFail(reply, error);
    }
  });

  app.post("/api/account/sign-out", async (req, reply) => {
    try {
      const result = await identityPort.signOut({
        headers: new Headers(
          Object.entries(req.headers).flatMap(([key, value]) =>
            Array.isArray(value)
              ? value.map((item) => [key, item] as [string, string])
              : value === undefined
                ? []
                : [[key, String(value)] as [string, string]],
          ),
        ),
      });
      if (result.setCookies.length > 0) reply.header("set-cookie", [...result.setCookies]);
      return reply.code(200).send({ ok: true });
    } catch (error) {
      return accountFail(reply, error);
    }
  });

  app.get("/api/account/sessions", async (req, reply) => {
    try {
      return reply.code(200).send({ sessions: await identityPort.listSessions({ actor: req.accountActor! }) });
    } catch (error) {
      return accountFail(reply, error);
    }
  });

  app.delete("/api/account/sessions/:sessionId", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(sessionId)) {
      return reply.code(400).send({ error: "Invalid session id." });
    }
    try {
      await identityPort.revokeOwnSession({
        actor: req.accountActor!,
        sessionId,
        command: accountCommand(req),
      });
      return reply.code(204).send();
    } catch (error) {
      return accountFail(reply, error);
    }
  });

  // Invite CREATE (P1.9): mint a single-use, expiring link that pre-sets a role for `accountId`.
  // Body: { accountId, role, expiresAt? }. GATED 'manageInvites' (admin+ of THAT account) via the
  // same authorize seam every permissioned route uses — OFF mode is the allow-all no-op (the token
  // is minted as DEMO_USER's act), auth-on requires admin-tier membership of `accountId` (a
  // cross-tenant stranger → 403). The token is a 32-byte CSPRNG value, base64url-encoded; it is the
  // ONLY secret here, so it is NEVER logged (it's returned in the body to the authorised caller and
  // nowhere else).
  //
  // P1.10 — an optional `preauthEmail` may be attached: a non-empty, email-shaped value is stored
  // NORMALIZED (trim+lowercase) and turns this into a pre-authorised invite that the accept route
  // binds ONLY for a caller whose VERIFIED email matches it (see preauthInviteAllows). Absent/empty
  // ⇒ stored as null ⇒ a P1.9 link invite (any signed-in caller may accept). Nothing is ever
  // emailed — the admin still hands out the link; preauthEmail only narrows who may redeem it.
  app.post("/api/invites", async (req, reply) => {
    const body = (req.body ?? {}) as {
      accountId?: unknown;
      role?: unknown;
      expiresAt?: unknown;
      preauthEmail?: unknown;
    };
    if (typeof body.accountId !== "string" || body.accountId.length === 0) {
      return accountFail(reply, validationFailed("accountId must be a non-empty string."));
    }
    if (!isKnownRole(body.role)) {
      return accountFail(reply, validationFailed("role must be one of owner, admin, editor, viewer."));
    }
    // Shape-check preauthEmail here before authorize(): an absent value or a string that is empty
    // after trim means a link invite (null), while any present non-string is invalid. Email syntax
    // remains enforced by the account-administration port after authorization, keeping the
    // transport-independent integrity boundary authoritative without changing 400/403 precedence.
    let preauthEmail: string | null = null;
    if (body.preauthEmail !== undefined && typeof body.preauthEmail !== "string") {
      return accountFail(reply, validationFailed("preauthEmail must be a valid email address."));
    }
    if (typeof body.preauthEmail === "string") {
      const trimmed = body.preauthEmail.trim();
      if (trimmed.length > 0) {
        preauthEmail = normalizeAccountEmail(trimmed); // store normalized so accept compares normalized↔normalized
      }
    }
    if (authMode === "sso" && preauthEmail === null) {
      return accountFail(reply, validationFailed("SSO-only onboarding requires an email-preauthorized invitation."));
    }
    // Gate BEFORE any write: admin+ of this account may create invites; a non-member/under-tier is 403.
    if (!authorize(req, reply, body.accountId, "manageInvites")) return;
    const requestedExpiry = body.expiresAt;
    let expiresAt: string | null;
    if (requestedExpiry === undefined) {
      // Null is canonical across retries. The account-administration port chooses the standard
      // bounded expiry only on first execution, so an idempotent retry cannot drift with wall time.
      expiresAt = null;
    } else {
      const parsed = typeof requestedExpiry === "string" ? parseStrictIsoInstant(requestedExpiry) : null;
      if (parsed === null) {
        return accountFail(reply, validationFailed("expiresAt must be a valid ISO-8601 timestamp."));
      }
      expiresAt = new Date(parsed).toISOString();
    }
    try {
      const invite = await accountAdminPort.createInvitation({
        actor: req.accountActor!,
        workspaceId: body.accountId,
        role: body.role,
        preauthorizedEmail: preauthEmail,
        expiresAt,
        command: accountCommand(req),
      });
      if (!wasAccountCommandReplayed(invite)) {
        audit(reply, {
          ts: invite.createdAt,
          userId: req.user!.id,
          accountId: invite.workspaceId,
          action: "inviteCreate",
          entity: "invite",
          id: invite.id,
          changedFields: ["role", "preauthEmail", "expiresAt"],
        });
      }
      // Echo back what the caller needs to build the link — NOT createdAt/usedAt. preauthEmail is
      // echoed (the admin set it; convenient confirmation of the NORMALIZED value), and only to this
      // already-authorised admin. Later privileged invitation-list reads also expose it, but no
      // public preview or bearer-token read does.
      return reply.code(201).send({
        id: invite.id,
        token: invite.token,
        accountId: invite.workspaceId,
        role: invite.role,
        expiresAt: invite.expiresAt,
        preauthEmail: invite.preauthorizedEmail,
      });
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // Invite PREVIEW: public because a new invitee has no session yet, but still bearer-authorized —
  // only someone holding the unguessable token can read this deliberately small display shape.
  // No membership/user table is touched, and no account data beyond the company name leaves.
  app.get("/api/invites/:token/preview", async (req, reply) => {
    const { token } = req.params as { token: string };
    try {
      const invite = await accountAdminPort.previewInvitation({ token });
      return {
        accountName: invite.workspaceName,
        role: invite.role,
        expiresAt: invite.expiresAt,
      };
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // Invite ACCEPT (P1.9): a signed-in caller redeems a link, binding the invited role to THEIR
  // membership. NO authorize() call — the membership is the OUTPUT of this route, not a precondition
  // (requireUser upstream already proved a real session, or attached DEMO_USER in OFF mode). The
  // token-state checks ARE the gate: unknown → 404, already-used → 409, expired → 410. P1.10 adds an
  // email-preauth gate AFTER those and BEFORE the bind: a non-null preauthEmail must match the
  // caller's email; SSO also requires the IdP's verified-email assertion, while password mode uses
  // possession of the addressed invite as verification. A null preauthEmail is the P1.9 link path
  // (any signed-in caller). On success the membership upsert and
  // the single-use stamp commit in ONE transaction (atomic bind), and markInviteUsed's
  // `usedAt IS NULL` clause double-guards single-use against a concurrent race.
  app.post("/api/invites/:token/accept", async (req, reply) => {
    const { token } = req.params as { token: string };
    try {
      if (
        authMode === "sso" &&
        (requiredSsoProviderId === null || req.authenticationProviderId !== requiredSsoProviderId)
      ) {
        // Preserve the route's unknown/used/expired precedence without consuming the invitation.
        // A valid token then receives the provider-specific refusal before any membership write.
        await accountAdminPort.previewInvitation({ token });
        throw new AccountContractError({
          code: "FORBIDDEN",
          message: "Sign in with the required SSO provider before accepting this invitation.",
          retryable: false,
        });
      }
      const accepted =
        authMode === "off"
          ? await accountAdminPort.claimInvitationForPrincipal({
              token,
              principalId: req.accountActor!.principalId,
              principalEmail: req.user!.email,
              emailVerified: true,
              passwordMode: false,
              command: accountCommand(req),
            })
          : await accountAdminPort.acceptInvitation({
              actor: req.accountActor!,
              token,
              principalEmail: req.user!.email,
              emailVerified: req.user!.emailVerified,
              command: accountCommand(req),
            });
      const now = new Date().toISOString();
      if (!wasAccountCommandReplayed(accepted)) {
        audit(reply, {
          ts: now,
          userId: req.user!.id,
          accountId: accepted.workspaceId,
          action: "inviteAccept",
          entity: "membership",
          id: req.user!.id,
          changedFields: ["role"],
        });
      }
      return reply.code(200).send({ accountId: accepted.workspaceId, role: accepted.role });
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // Password-only invite onboarding. The bearer token narrowly authorizes creating one identity;
  // the membership bind and token consumption then commit atomically before the route succeeds.
  // The client signs in afterwards and goes straight to the app because the invite is already used.
  app.post("/api/invites/:token/signup", async (req, reply) => {
    if (authMode !== "password" || !authenticationConfigured) {
      return reply.code(404).send({ error: "Not found." });
    }
    const { token } = req.params as { token: string };
    const body = (req.body ?? {}) as {
      email?: unknown;
      name?: unknown;
      password?: unknown;
    };
    const email = typeof body.email === "string" ? normalizeAccountEmail(body.email) : "";
    if (!isAccountEmail(email)) {
      return reply.code(400).send({ error: "A valid email address is required." });
    }
    const name = typeof body.name === "string" ? cleanText(body.name) : "";
    if (name.length === 0) {
      return reply.code(400).send({ error: "Name is required." });
    }
    if (typeof body.password !== "string" || passwordLengthFailure(body.password)) {
      return reply.code(400).send({
        error: `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.`,
      });
    }
    try {
      const result = await accountFlows!.acceptInviteWithPasswordSignup({
        token,
        email,
        displayName: name,
        password: body.password,
        command: accountCommand(req),
      });
      if (!wasAccountCommandReplayed(result)) {
        audit(reply, {
          ts: new Date().toISOString(),
          userId: result.principalId,
          accountId: result.membership.workspaceId,
          action: "inviteAccept",
          entity: "member",
          id: result.principalId,
          changedFields: ["role", "status"],
        });
      }
      return reply.code(201).send({
        ok: true,
        accountId: result.membership.workspaceId,
        role: result.membership.role,
      });
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // ── Member management (P1.11) ────────────────────────────────────────────────────────────────
  // Owner/Admin list / change-role / revoke members of THEIR account, plus list / revoke outstanding
  // invites. Every route gates through the SAME authorize seam (cross-tenant → 403 automatically):
  // members under 'manageMembers', invites under 'manageInvites' (both admin-tier). The pure shared
  // guards (canManageMemberRole / canRemoveMember) keep Owner outside ordinary role and removal
  // operations for every actor. Owner changes are not ordinary member mutations: the single
  // Owner moves only through the transactional transfer endpoint, while a partial unique index and
  // boot assertion enforce exactly one Owner for every member-bearing company. OFF mode
  // (trusted-local) has no real member model, so the list routes return empty and mutation routes
  // explicitly report the unavailable capability instead of claiming an inert request committed.
  const rejectTrustedLocalMemberMutation = (reply: FastifyReply): unknown =>
    reply.code(400).send({
      error: "Member management is unavailable in trusted-local mode.",
    });

  // LIST members. Joins the membership rows with Better Auth user identity (name/email, read ONLY
  // here, only for this authorized admin). isSelf marks the caller's own row (the client derives its
  // role from it). A missing name/email degrades to null — never a throw.
  app.get("/api/accounts/:accountId/members", async (req, reply) => {
    const { accountId } = req.params as { accountId: string };
    if (!authorize(req, reply, accountId, "manageMembers")) return;
    // OFF mode: no real member model (req.user is DEMO_USER, membership is unread) — return empty so
    // the shape is honest and nothing crashes. The UI is hidden in OFF, so this is belt-and-braces.
    if (authMode === "off") return { members: [] };
    try {
      const directory = await accountFlows!.listMemberDirectory({
        actor: req.accountActor!,
        workspaceId: accountId,
      });
      const identityAdministration = await accountAdminPort.evaluateIdentityAdminAuthoritiesForTargets({
        actor: req.accountActor!,
        targetPrincipalIds: directory.map(({ membership }) => membership.principalId),
        actions: ["issue-password-reset", "revoke-sessions"],
      });
      const members = directory.map(({ membership: member, principal }) => {
        const targetAdministration = identityAdministration.get(member.principalId)!;
        const reset = targetAdministration.get("issue-password-reset")!;
        const revoke = targetAdministration.get("revoke-sessions")!;
        return {
          userId: member.principalId,
          role: member.role,
          status: member.status,
          createdAt: member.joinedAt,
          name: principal?.displayName ?? null,
          email: principal?.email ?? null,
          // Derived from the newest RETAINED session, so it silently becomes null once a member's
          // last session ages out. It is a convenience column, never an authorization input.
          lastLoginAt: principal?.lastAuthenticatedAt ?? null,
          isSelf: member.principalId === req.accountActor!.principalId,
          mayResetPassword: authMode === "password" && reset.allowed,
          mayRevokeSessions: revoke.allowed,
        };
      });
      return { members };
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // CHANGE a non-owner member's ordinary role. Owner is rejected at shape/policy level for every
  // actor; the only ownership mutation is the explicit atomic transfer route below.
  app.patch("/api/accounts/:accountId/members/:userId", async (req, reply) => {
    const { accountId, userId } = req.params as {
      accountId: string;
      userId: string;
    };
    const body = (req.body ?? {}) as { role?: unknown };
    if (!isKnownRole(body.role)) {
      return reply.code(400).send({ error: "role must be one of owner, admin, editor, viewer." });
    }
    const nextRole = body.role;
    if (!authorize(req, reply, accountId, "manageMembers")) return;
    if (authMode === "off") return rejectTrustedLocalMemberMutation(reply);
    try {
      const changed = await accountAdminPort.changeMemberRole({
        actor: req.accountActor!,
        workspaceId: accountId,
        targetPrincipalId: userId,
        nextRole,
        command: accountCommand(req),
      });
      if (!wasAccountCommandReplayed(changed)) {
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId,
          action: "memberRole",
          entity: "membership",
          id: userId,
          changedFields: ["role"],
        });
      }
      return reply.code(200).send({ userId: changed.principalId, role: changed.role });
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // CHANGE a member's lifecycle status: disable, archive, or restore to active. The role and join
  // date are untouched — only the authority to enter the account changes, because every
  // authorization read narrows on status = 'active'. Owner targets and the caller's own membership
  // are refused by the pure guard (canChangeMemberStatus); an administrator must not be able to
  // strand the account without an Owner, nor lock themselves out of the account they administer.
  app.patch("/api/accounts/:accountId/members/:userId/status", async (req, reply) => {
    const { accountId, userId } = req.params as {
      accountId: string;
      userId: string;
    };
    const body = (req.body ?? {}) as { status?: unknown };
    if (!isMembershipStatus(body.status)) {
      return reply.code(400).send({
        error: "status must be one of active, disabled, archived.",
      });
    }
    const nextStatus = body.status;
    if (!authorize(req, reply, accountId, "manageMembers")) return;
    if (authMode === "off") return rejectTrustedLocalMemberMutation(reply);
    try {
      const changed = await accountAdminPort.changeMemberStatus({
        actor: req.accountActor!,
        workspaceId: accountId,
        targetPrincipalId: userId,
        nextStatus,
        command: accountCommand(req),
      });
      if (!wasAccountCommandReplayed(changed)) {
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId,
          action: "memberStatus",
          entity: "membership",
          id: userId,
          changedFields: ["status"],
        });
      }
      return reply.code(200).send({ userId: changed.principalId, status: changed.status });
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // REVOKE a member. 404 non-member; 403 by the pure guard (the Owner is never removable here).
  // 204 on success.
  app.delete("/api/accounts/:accountId/members/:userId", async (req, reply) => {
    const { accountId, userId } = req.params as {
      accountId: string;
      userId: string;
    };
    if (!authorize(req, reply, accountId, "manageMembers")) return;
    if (authMode === "off") return rejectTrustedLocalMemberMutation(reply);
    try {
      const removed = await accountAdminPort.removeMember({
        actor: req.accountActor!,
        workspaceId: accountId,
        targetPrincipalId: userId,
        command: accountCommand(req),
      });
      if (!wasAccountCommandReplayed(removed)) {
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId,
          action: "memberRemove",
          entity: "membership",
          id: userId,
          changedFields: [],
        });
      }
      return reply.code(204).send();
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // TRANSFER ownership (P1.11): hand the account to another EXISTING member and step the caller down
  // to admin, atomically. Gated 'transferOwnership' — the ONE action above admin in the matrix, so a
  // mere admin is 403 (authorize resolves the caller's role for this account). Body { toUserId }. The
  // target must already be an active member (404 else) and not the caller (400 — you're already owner).
  // Demote-caller and promote-target commit in ONE tx, so no other request observes an ownerless
  // account and the v10 unique index never permits co-owners. OFF mode has no owner model and
  // reports that member management is unavailable.
  app.post("/api/accounts/:accountId/transfer-ownership", async (req, reply) => {
    const { accountId } = req.params as { accountId: string };
    const body = (req.body ?? {}) as { toUserId?: unknown };
    if (typeof body.toUserId !== "string" || body.toUserId.length === 0) {
      return reply.code(400).send({ error: "toUserId must be a non-empty string." });
    }
    const toUserId = body.toUserId;
    if (!authorize(req, reply, accountId, "transferOwnership")) return;
    if (authMode === "off") return rejectTrustedLocalMemberMutation(reply);
    try {
      const now = new Date().toISOString();
      const transferred = await accountAdminPort.transferOwnership({
        actor: req.accountActor!,
        workspaceId: accountId,
        targetPrincipalId: toUserId,
        command: accountCommand(req),
      });
      if (!wasAccountCommandReplayed(transferred)) {
        audit(reply, {
          ts: now,
          userId: req.user!.id,
          accountId,
          action: "ownershipTransfer",
          entity: "membership",
          id: toUserId,
          changedFields: ["role"],
        });
      }
      return reply.code(200).send({ toUserId, role: "owner" });
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // RESET PASSWORD (P1.18): mint a single-use, 24h reset LINK token for a member — the app has
  // no email infrastructure (a standing non-goal), so the admin hands the link over out-of-band,
  // exactly like an invite. Gated 'manageMembers' + the account policy's identity-administration guard (an
  // admin must never reset an OWNER — a reset link is an account-takeover capability, so this is
  // the same escalation door the no-admin→owner-grant rule closes). Password mode ONLY: 'sso'
  // delegates credentials to the IdP (400, not a crash), and OFF has no credentials at all. The
  // token rides Better Auth's own verification store (single-use, expiring) and is WRITE-ONCE:
  // returned exactly here, never listed or read back — same posture as the invite token.
  app.post("/api/accounts/:accountId/members/:userId/reset-password", async (req, reply) => {
    const { accountId, userId } = req.params as {
      accountId: string;
      userId: string;
    };
    if (!authorize(req, reply, accountId, "manageMembers")) return;
    if (authMode !== "password") {
      // 'sso': the IdP owns sign-in — resetting a local password is meaningless there. 'off':
      // trusted-local, no credential model (and no UI shows the button) — a clear 400 either way.
      return reply.code(400).send({
        error: "Password reset links require a deployment profile with password sign-in enabled.",
      });
    }
    try {
      const command = accountCommand(req);
      // includeInactive: an existence probe, not an authorization one (that is the port's job just
      // below). An admin disables a compromised account first and rotates its password second, so an
      // active-only probe here would 404 exactly the case this route exists for.
      const targetMembership = await accountAdminPort.getMembership({
        principalId: userId,
        workspaceId: accountId,
        includeInactive: true,
      });
      if (!targetMembership) {
        return accountFail(reply, memberNotFound(command));
      }
      const ceremony = await accountFlows!.issuePasswordReset({
        actor: req.accountActor!,
        targetPrincipalId: userId,
        command,
      });
      if (!wasAccountCommandReplayed(ceremony)) {
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId,
          action: "passwordResetIssue",
          entity: "identity",
          id: userId,
          changedFields: ["credential"],
        });
      }
      return reply.code(201).send({ token: ceremony.token, expiresAt: ceremony.expiresAt });
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // Revoke every active session for a member. Session state is identity-global, so the actor must
  // have reset-equivalent authority in every account the target belongs to; an admin of account X
  // cannot disrupt an owner of account Y merely because the identity is also present in X.
  app.post("/api/accounts/:accountId/members/:userId/revoke-sessions", async (req, reply) => {
    const { accountId, userId } = req.params as {
      accountId: string;
      userId: string;
    };
    if (!authorize(req, reply, accountId, "manageMembers")) return;
    if (authMode === "off" || !authenticationConfigured) {
      return reply.code(400).send({ error: "Sessions require authentication." });
    }
    try {
      const command = accountCommand(req);
      // includeInactive, for the same reason as the reset-password route above: killing the sessions
      // of an account you have just suspended is the point, not an edge case.
      const targetMembership = await accountAdminPort.getMembership({
        principalId: userId,
        workspaceId: accountId,
        includeInactive: true,
      });
      if (!targetMembership) return accountFail(reply, memberNotFound(command));
      const revoked = await accountFlows!.revokeMemberSessions({
        actor: req.accountActor!,
        targetPrincipalId: userId,
        command,
      });
      if (!wasAccountCommandReplayed(revoked)) {
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId,
          action: "sessionsRevoke",
          entity: "identity",
          id: userId,
          changedFields: ["sessions"],
        });
      }
      return reply.code(204).send();
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // LIST outstanding invites — NO token in the response (it's a write-once bearer secret; see
  // listInvitesForAccount). Gated 'manageInvites'. OFF → empty.
  app.get("/api/accounts/:accountId/invites", async (req, reply) => {
    const { accountId } = req.params as { accountId: string };
    if (!authorize(req, reply, accountId, "manageInvites")) return;
    if (authMode === "off") return { invites: [] };
    try {
      const invites = await accountAdminPort.listInvitations({
        actor: req.accountActor!,
        workspaceId: accountId,
      });
      return {
        invites: invites.map((invite) => ({
          id: invite.id,
          accountId: invite.workspaceId,
          role: invite.role,
          preauthEmail: invite.preauthorizedEmail,
          expiresAt: invite.expiresAt,
          usedAt: invite.usedAt,
          createdAt: invite.createdAt,
        })),
      };
    } catch (err) {
      return accountFail(reply, err);
    }
  });

  // REVOKE an invite by its non-secret id. Idempotent + scoped by accountId (cross-tenant guard);
  // 204 regardless of whether a row existed (don't leak existence). Gated 'manageInvites'.
  app.delete("/api/accounts/:accountId/invites/:id", async (req, reply) => {
    const { accountId, id } = req.params as { accountId: string; id: string };
    if (!authorize(req, reply, accountId, "manageInvites")) return;
    try {
      const revoked = await accountAdminPort.revokeInvitation({
        actor: req.accountActor!,
        workspaceId: accountId,
        invitationId: id,
        command: accountCommand(req),
      });
      if (revoked.changed && !wasAccountCommandReplayed(revoked)) {
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId,
          action: "inviteRevoke",
          entity: "invite",
          id,
          changedFields: [],
        });
      }
      return reply.code(204).send();
    } catch (err) {
      return accountFail(reply, err);
    }
  });
}
