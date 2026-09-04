import type { Role } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { revokeResetTokensForUser } from "../auth";
import { tx } from "../txn";
import { SINGLE_OWNER_INDEX } from "./assert";
import { isKnownRole } from "./members.model";

/**
 * Upgrade the control plane to the exactly-one-Owner model.
 *
 * Alpha builds briefly allowed co-owners and Owner invites. Migration keeps the oldest active
 * Owner (createdAt, then userId for deterministic ties), demotes every additional active Owner to
 * Admin, revokes unused Owner invites, then installs the partial unique index that prevents
 * co-ownership recurring. Used Owner invites remain as non-secret historical rows; they cannot be
 * redeemed again.
 *
 * Idempotent and transaction-safe; database migration v10 is its only production caller.
 */
export function migrateSingleOwnerControlPlaneV10(db: Db): void {
  tx(db, () => {
    db.exec(`
      UPDATE account_members AS demoted
         SET role = 'admin'
       WHERE demoted.role = 'owner'
         AND demoted.status = 'active'
         AND EXISTS (
           SELECT 1
             FROM account_members AS retained
            WHERE retained.accountId = demoted.accountId
              AND retained.role = 'owner'
              AND retained.status = 'active'
              AND (
                retained.createdAt < demoted.createdAt OR
                (retained.createdAt = demoted.createdAt AND retained.userId < demoted.userId)
              )
         );
      DELETE FROM invites WHERE role = 'owner' AND usedAt IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS ${SINGLE_OWNER_INDEX}
        ON account_members(accountId)
        WHERE role = 'owner' AND status = 'active';
    `);
  });
}

/**
 * Role-tier ranking for the ownerless-repair promotion below — `owner > admin > editor > viewer`.
 * Mirrors shared/domain/access.ts's private `ROLE_RANK`; that constant is NOT exported and `shared/`
 * is off the server's SQL path, so the ordering is re-stated here as a SQL `CASE` and kept in
 * lock-step by being byte-identical to it. An unknown role sorts BELOW viewer (`-1`) so a corrupt
 * value can never win the promotion. Passed a table alias (e.g. `promoted`) and emits the ranked
 * integer for that row's `role`.
 */
const roleTierSql = (alias: string): string =>
  `CASE ${alias}.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'editor' THEN 1 WHEN 'viewer' THEN 0 ELSE -1 END`;

/**
 * Loudly record ONE v11 ownerless-account promotion. There is no request-scoped audit sink or
 * `securityLog` at boot (those are wired into buildApp per-request; a migration only has the raw
 * `Db`), so `console` IS the established surface here — the same fallback app.ts/audit.ts use when
 * their sink is unavailable. Every promotion emits a structured `capacitylens.security` line so an
 * operator can see WHO was handed Owner authority by an upgrade; a promotion of a member BELOW admin
 * (an editor or, in the documented last-resort, a viewer) is the sensitive case and additionally
 * escalates to `console.error` naming the account and member — surfacing, never swallowing (§1).
 *
 * @param accountId     The ownerless account being repaired.
 * @param userId        The member promoted to Owner.
 * @param promotedFrom  The member's role BEFORE promotion (admin | editor | viewer).
 */
function reportOwnerlessPromotion(accountId: string, userId: string, promotedFrom: Role): void {
  const belowAdmin = promotedFrom === "editor" || promotedFrom === "viewer";
  const record = JSON.stringify({
    type: "capacitylens.security",
    event: "ownerless-owner-promotion",
    outcome: "promoted",
    migration: "v11",
    accountId,
    userId,
    promotedFromRole: promotedFrom,
    belowAdmin,
  });
  if (belowAdmin) {
    // No admin OR editor... (viewer) / no admin (editor) existed: a member below admin now holds full
    // Owner authority. Loudest surface — an operator should review this promotion.
    console.error(
      `capacitylens-server: SECURITY — ownerless account ${accountId} had no admin${promotedFrom === "viewer" ? " or editor" : ""}; promoted ${promotedFrom} member ${userId} to Owner (below-admin elevation). ${record}`,
    );
  } else {
    console.warn(
      `capacitylens-server: ownerless account ${accountId} repaired — promoted ${promotedFrom} member ${userId} to Owner. ${record}`,
    );
  }
}

export interface OwnerlessPromotionV11 {
  accountId: string;
  userId: string;
  promotedFrom: Role;
}

/** Emit v11's security outcomes only after the migration runner has committed their writes. */
export function reportOwnerlessPromotionsV11(promotions: readonly OwnerlessPromotionV11[]): void {
  for (const promotion of promotions) {
    reportOwnerlessPromotion(promotion.accountId, promotion.userId, promotion.promotedFrom);
  }
}

/**
 * Migration v11 completes the exactly-one-Owner rule for databases that had active members but no
 * Owner. The single HIGHEST-role-tier active member is promoted (`owner > admin > editor > viewer`),
 * tie-broken by the earliest membership (createdAt, then userId) — so an admin is chosen over an
 * older viewer, an editor only when no admin exists, and a viewer only when the account holds nothing
 * but viewers. Auth-off datasets with no membership rows remain untouched.
 *
 * POLICY (documented call — DECISIONS.md 2026-07-17, entry by the orchestrator; flagged REVISITABLE):
 * promoting by tier — rather than the earlier "oldest member regardless of role" rule — stops a
 * routine upgrade silently escalating a viewer to full Owner authority (private client/project names,
 * purge, destructive imports, member management, ownership transfer) whenever a more-privileged member
 * exists. The single-Owner invariant (assertSingleOwnerControlPlaneCurrent) requires exactly one
 * active Owner per member-bearing account, so an ownerless account CANNOT simply be left un-promoted —
 * that would brick startup. The last-resort viewer promotion (an account of viewers only) is therefore
 * retained but made LOUD (see {@link reportOwnerlessPromotionsV11}) rather than refused. This was chosen
 * over refuse-and-halt precisely to avoid bricking upgrades; revisit if a safer path (e.g. an operator
 * repair step) becomes available.
 *
 * Promotions are written with RAW SQL — deliberately NOT via upsertMember — so its reset-ceremony
 * invalidation does NOT fire here; migration v12 revokes outstanding ceremonies for every active Owner
 * afterwards (that ordering is asserted by controlTables.test.ts). IDEMPOTENT: once every account has
 * an Owner there is nothing left to promote, so a second run is a no-op.
 */
export function migrateOwnerlessControlPlaneV11(db: Db): OwnerlessPromotionV11[] {
  return tx(db, () => {
    // One promotion target per ownerless account: the active member no OTHER active member outranks,
    // where "outranks" = strictly higher role tier, OR the same tier but an earlier membership. This
    // extends the previous earliest-membership NOT EXISTS with the tier comparison, so exactly one row
    // per ownerless account qualifies (userId is unique per account, so the tie-break is total).
    const targets = db
      .prepare(
        `
      SELECT promoted.accountId AS accountId, promoted.userId AS userId, promoted.role AS role
        FROM account_members AS promoted
       WHERE promoted.status = 'active'
         AND NOT EXISTS (
           SELECT 1
             FROM account_members AS existing_owner
            WHERE existing_owner.accountId = promoted.accountId
              AND existing_owner.role = 'owner'
              AND existing_owner.status = 'active'
         )
         AND NOT EXISTS (
           SELECT 1
             FROM account_members AS better_member
            WHERE better_member.accountId = promoted.accountId
              AND better_member.status = 'active'
              AND (
                ${roleTierSql("better_member")} > ${roleTierSql("promoted")}
                OR (
                  ${roleTierSql("better_member")} = ${roleTierSql("promoted")}
                  AND (
                    better_member.createdAt < promoted.createdAt OR
                    (better_member.createdAt = promoted.createdAt AND better_member.userId < promoted.userId)
                  )
                )
              )
         );
    `,
      )
      .all() as Array<{ accountId: string; userId: string; role: string }>;

    const promote = db.prepare(
      `UPDATE account_members SET role = 'owner' WHERE accountId = ? AND userId = ? AND status = 'active'`,
    );
    const promotions: OwnerlessPromotionV11[] = [];
    for (const target of targets) {
      promote.run(target.accountId, target.userId);
      // A stored role that is not a known Role is control-table corruption (every write goes through
      // upsertMember's guard) — fail LOUD rather than mis-report the promotion (mirrors the readers).
      if (!isKnownRole(target.role)) {
        throw new Error(
          `migrateOwnerlessControlPlaneV11: stored role ${JSON.stringify(target.role)} for (${target.accountId}, ${target.userId}) is not a known role — control table corrupted.`,
        );
      }
      promotions.push({ accountId: target.accountId, userId: target.userId, promotedFrom: target.role });
    }
    return promotions;
  });
}

/** Migration v12 closes the reset-ceremony gap in historical v11 databases. V11 promoted the
 * oldest member of an ownerless company with raw SQL, bypassing upsertMember's privilege-change
 * invalidation. Revoke outstanding verification ceremonies for every active Owner: this includes
 * anyone v11 promoted on an already-upgraded database and is harmless for pre-existing Owners. */
export function migrateOwnerResetCeremoniesV12(db: Db): void {
  tx(db, () => {
    const owners = db
      .prepare(
        `
      SELECT DISTINCT userId
        FROM account_members
       WHERE role = 'owner' AND status = 'active'
    `,
      )
      .all() as Array<{ userId: string }>;
    for (const { userId } of owners) revokeResetTokensForUser(db, userId);
  });
}

/** Migration v14 closes the reset-ceremony gap v12 left for DEMOTED identities. The v10-era owner
 * repairs demoted co-owners to admin with raw SQL, bypassing upsertMember's privilege-change
 * invalidation — but v12 revoked ceremonies for ACTIVE OWNERS ONLY, so a demoted co-owner kept any
 * reset link minted while they still held Owner privilege.
 *
 * BLANKET scope on purpose: revoke for EVERY active member, with no role filter. Targeting only the
 * demoted identities is PROVABLY IMPOSSIBLE — the original v11 repair overwrote roles in place and
 * destroyed the role history a targeted revocation would need (the same destroyed-information
 * reasoning that justified v11's supersession allow-list in db.ts). Over-revoking is harmless: a
 * reset link is re-issuable on demand, and revokeResetTokensForUser already no-ops for members with
 * no outstanding ceremony. Under-revoking is the vulnerability. Membership rows are never touched. */
export function migrateMemberResetCeremoniesV14(db: Db): void {
  tx(db, () => {
    const members = db
      .prepare(
        `
      SELECT DISTINCT userId
        FROM account_members
       WHERE status = 'active'
    `,
      )
      .all() as Array<{ userId: string }>;
    for (const { userId } of members) revokeResetTokensForUser(db, userId);
  });
}
