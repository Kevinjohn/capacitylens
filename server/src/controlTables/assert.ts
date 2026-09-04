import type { Db } from "../db";

/** Physical uniqueness backstop for the exactly-one-active-Owner product rule. The partial index
 * permits any number of non-owner memberships while allowing at most one active Owner per account;
 * the post-migration assertion below independently rejects a member-bearing account with no Owner. */
export const SINGLE_OWNER_INDEX = "idx_account_members_single_active_owner";

/** Verify the app-owned control plane after migration. These tables deliberately sit outside
 * AppData/TABLES, so schema.ts cannot cover them; without this companion assertion a missed future
 * control-table migration would otherwise surface only when an account or invite route is used. */
export function assertControlTablesCurrent(db: Db): void {
  const accountMemberColumns = db.prepare("PRAGMA table_info(account_members)").all() as Array<{
    name: string;
    notnull: number;
    pk: number;
    type: string;
  }>;
  const expectedColumns: Record<string, Record<string, { notNull: boolean; primaryKey: number }>> = {
    account_members: {
      accountId: { notNull: true, primaryKey: 1 },
      userId: { notNull: true, primaryKey: 2 },
      role: { notNull: true, primaryKey: 0 },
      status: { notNull: true, primaryKey: 0 },
      createdAt: { notNull: true, primaryKey: 0 },
      ...(accountMemberColumns.some(({ name }) => name === "signInConfirmed")
        ? { signInConfirmed: { notNull: false, primaryKey: 0 } }
        : {}),
    },
    invites: {
      tokenHash: { notNull: true, primaryKey: 1 },
      id: { notNull: true, primaryKey: 0 },
      accountId: { notNull: true, primaryKey: 0 },
      role: { notNull: true, primaryKey: 0 },
      preauthEmail: { notNull: false, primaryKey: 0 },
      expiresAt: { notNull: true, primaryKey: 0 },
      usedAt: { notNull: false, primaryKey: 0 },
      createdAt: { notNull: true, primaryKey: 0 },
    },
  };
  const problems: string[] = [];
  for (const [table, expected] of Object.entries(expectedColumns)) {
    // account_members was already fetched above (to decide whether signInConfirmed is expected) —
    // reuse it rather than re-running the identical PRAGMA a second time.
    const columns =
      table === "account_members"
        ? accountMemberColumns
        : (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
            name: string;
            notnull: number;
            pk: number;
            type: string;
          }>);
    const live = new Map(columns.map((column) => [column.name, column]));
    for (const column of columns) {
      if (!Object.hasOwn(expected, column.name)) problems.push(`unexpected ${table}.${column.name}`);
    }
    for (const [name, definition] of Object.entries(expected)) {
      if (!live.has(name)) problems.push(`missing ${table}.${name}`);
      else {
        const column = live.get(name)!;
        if ((column.notnull === 1) !== definition.notNull) {
          problems.push(
            `${table}.${name} is ${column.notnull === 1 ? "NOT NULL" : "nullable"} (expected ${definition.notNull ? "NOT NULL" : "nullable"})`,
          );
        }
        if (column.type.toUpperCase() !== "TEXT") {
          problems.push(`${table}.${name} declared type is ${column.type || "(empty)"} (expected TEXT)`);
        }
      }
    }
    const actualPrimaryKey = columns
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name);
    const expectedPrimaryKey = Object.entries(expected)
      .filter(([, definition]) => definition.primaryKey > 0)
      .sort((left, right) => left[1].primaryKey - right[1].primaryKey)
      .map(([name]) => name);
    if (actualPrimaryKey.join(",") !== expectedPrimaryKey.join(",")) {
      problems.push(
        `${table} primary-key mismatch: got (${actualPrimaryKey.join(", ")}), expected (${expectedPrimaryKey.join(", ")})`,
      );
    }
  }

  const expectedIndexes: Record<
    string,
    Record<string, { unique: boolean; columns: string[]; descending?: string[]; partial?: boolean }>
  > = {
    account_members: {
      idx_account_members_userId: { unique: false, columns: ["userId"] },
      idx_account_members_accountId: { unique: false, columns: ["accountId"] },
    },
    invites: {
      idx_invites_id: { unique: true, columns: ["id"] },
      idx_invites_accountId: { unique: false, columns: ["accountId"] },
      idx_invites_account_usedAt_id: {
        unique: false,
        columns: ["accountId", "usedAt", "id"],
        descending: ["usedAt"],
        partial: true,
      },
      idx_invites_live_preauthEmail: { unique: false, columns: ["preauthEmail"], partial: true },
    },
  };
  for (const [table, expected] of Object.entries(expectedIndexes)) {
    const live = new Map(
      (
        db.prepare(`PRAGMA index_list(${table})`).all() as Array<{
          name: string;
          unique: number;
          origin: string;
          partial: number;
        }>
      ).map((index) => [index.name, index]),
    );
    for (const [name, definition] of Object.entries(expected)) {
      if (!live.has(name)) problems.push(`missing index ${name}`);
      else {
        const index = live.get(name)!;
        if (
          (index.unique === 1) !== definition.unique ||
          index.origin !== "c" ||
          (index.partial === 1) !== (definition.partial ?? false)
        ) {
          problems.push(`index ${name} metadata mismatch`);
        }
        const keys = (
          db.prepare(`PRAGMA index_xinfo("${name}")`).all() as Array<{
            name: string | null;
            desc: number;
            coll: string;
            key: number;
          }>
        ).filter((column) => column.key === 1);
        if (
          keys.length !== definition.columns.length ||
          keys.some(
            (column, index) =>
              column.name !== definition.columns[index] ||
              (column.desc === 1) !== (definition.descending?.includes(column.name ?? "") ?? false) ||
              column.coll !== "BINARY",
          )
        ) {
          problems.push(`index ${name} does not cover exactly ${table}(${definition.columns.join(", ")})`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`DB control schema is behind the current model — ${problems.join("; ")}.`);
  }
}

/** Historical v10 assertion. Keep its semantics stable: v10 enforced at most one active Owner and
 * removed live Owner invites, while v11 adds the zero-Owner half of the invariant. */
export function assertSingleOwnerControlPlaneV10(db: Db): void {
  const index = (
    db.prepare(`PRAGMA index_list(account_members)`).all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>
  ).find((candidate) => candidate.name === SINGLE_OWNER_INDEX);
  if (!index || index.unique !== 1 || index.partial !== 1) {
    throw new Error(
      `DB control schema is behind the current model — missing partial unique index ${SINGLE_OWNER_INDEX}.`,
    );
  }
  const duplicate = db
    .prepare(
      `
    SELECT accountId, COUNT(*) AS owners
      FROM account_members
     WHERE role = 'owner' AND status = 'active'
     GROUP BY accountId
    HAVING COUNT(*) > 1
     LIMIT 1
  `,
    )
    .get() as { accountId: string; owners: number } | undefined;
  if (duplicate) {
    throw new Error(
      `DB control data violates the exactly-one-Owner invariant — ${duplicate.accountId} has ${duplicate.owners} active Owners.`,
    );
  }
  const pendingOwnerInvite = db
    .prepare(`SELECT id FROM invites WHERE role = 'owner' AND usedAt IS NULL LIMIT 1`)
    .get() as { id: string } | undefined;
  if (pendingOwnerInvite) {
    throw new Error("DB control data contains an unused Owner invite; ownership must be transferred, never invited.");
  }
}

/** Assert the current control-plane invariant after every database open. Kept separate from
 * assertControlTablesCurrent because migration v8 intentionally calls that historical assertion
 * before the owner migrations have run. */
export function assertSingleOwnerControlPlaneCurrent(db: Db): void {
  const columns = db.prepare(`PRAGMA index_info(${SINGLE_OWNER_INDEX})`).all() as Array<{ name: string }>;
  const definition = db
    .prepare(`SELECT tbl_name AS tableName, sql FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(SINGLE_OWNER_INDEX) as { tableName: string; sql: string | null } | undefined;
  const normalizeSql = (sql: string): string =>
    sql
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\s*([(),=])\s*/g, "$1")
      .replace(/;$/, "")
      .trim();
  const expectedDefinition = normalizeSql(
    `CREATE UNIQUE INDEX ${SINGLE_OWNER_INDEX} ON account_members(accountId) WHERE role = 'owner' AND status = 'active'`,
  );
  if (
    columns.length !== 1 ||
    columns[0]?.name !== "accountId" ||
    definition?.tableName !== "account_members" ||
    !definition.sql ||
    normalizeSql(definition.sql) !== expectedDefinition
  ) {
    throw new Error(`DB control schema has an invalid definition for partial unique index ${SINGLE_OWNER_INDEX}.`);
  }

  const pendingOwnerInvite = db
    .prepare(`SELECT id FROM invites WHERE role = 'owner' AND usedAt IS NULL LIMIT 1`)
    .get() as { id: string } | undefined;
  if (pendingOwnerInvite) {
    throw new Error("DB control data contains an unused Owner invite; ownership must be transferred, never invited.");
  }

  // Auth-off demo datasets intentionally have no membership rows. Once an account has any active
  // member, however, it must have exactly one active Owner — zero and co-owner states both fail.
  const invalidAccount = db
    .prepare(
      `
    SELECT accountId,
           SUM(CASE WHEN role = 'owner' THEN 1 ELSE 0 END) AS owners
      FROM account_members
     WHERE status = 'active'
     GROUP BY accountId
    HAVING SUM(CASE WHEN role = 'owner' THEN 1 ELSE 0 END) <> 1
     LIMIT 1
  `,
    )
    .get() as { accountId: string; owners: number } | undefined;
  if (invalidAccount) {
    throw new Error(
      `DB control data violates the exactly-one-Owner invariant — ${invalidAccount.accountId} has ${invalidAccount.owners} active Owners.`,
    );
  }
}
