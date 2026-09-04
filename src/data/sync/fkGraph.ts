import type { AppData, AppDataKey, ScopedEntityKey } from "@capacitylens/shared/types/entities";

const rowsReference = (record: Record<string, unknown>, table: string, field: string): boolean =>
  Array.isArray(record[table]) &&
  record[table].some(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as Record<string, unknown>)[field] === "string" &&
      (row as Record<string, unknown>)[field] !== "",
  );

/** One foreign key a returned `child` row can use to point at a row in `parent`. */
type FkEdge = {
  [K in AppDataKey]: {
    child: K;
    parent: AppDataKey;
    field: Extract<keyof AppData[K][number], string>;
  };
}[AppDataKey];

// The payload's foreign-key graph, as data. A parent table may only be treated as "absent because
// this server version predates it" when NOTHING in the returned payload still points into it, so
// this list must stay exhaustive; `satisfies` proves each child/field pair is a real column, and the
// account-scope witness below proves every scoped table's `accountId` edge is present.
const FK_EDGES = [
  { child: "disciplines", parent: "accounts", field: "accountId" },
  { child: "resources", parent: "accounts", field: "accountId" },
  { child: "clients", parent: "accounts", field: "accountId" },
  { child: "projects", parent: "accounts", field: "accountId" },
  { child: "phases", parent: "accounts", field: "accountId" },
  { child: "activities", parent: "accounts", field: "accountId" },
  { child: "allocations", parent: "accounts", field: "accountId" },
  { child: "timeOff", parent: "accounts", field: "accountId" },
  { child: "closures", parent: "accounts", field: "accountId" },
  { child: "resources", parent: "disciplines", field: "disciplineId" },
  { child: "allocations", parent: "resources", field: "resourceId" },
  { child: "timeOff", parent: "resources", field: "resourceId" },
  { child: "projects", parent: "clients", field: "clientId" },
  { child: "phases", parent: "projects", field: "projectId" },
  { child: "activities", parent: "projects", field: "projectId" },
  { child: "resources", parent: "projects", field: "projectId" },
  { child: "allocations", parent: "projects", field: "projectId" },
  { child: "activities", parent: "phases", field: "phaseId" },
  { child: "allocations", parent: "activities", field: "activityId" },
] as const satisfies readonly FkEdge[];

// Compile-completeness guard in the same idiom as SCOPED_KEYS/IMPORTED_FIELDS: the accounts parent
// used to be derived by iterating SCOPED_KEYS, so a NEW scoped table would automatically have been
// covered. Enumerating the edges gives up that automatism, and this witness buys it back — adding a
// scoped table without its `accountId` edge above fails the build instead of silently letting a
// version-skewed server drop `accounts` while that table's rows still reference it.
type MissingAccountScopeEdge = Exclude<
  ScopedEntityKey,
  Extract<(typeof FK_EDGES)[number], { parent: "accounts" }>["child"]
>;
const accountScopeEdgesAreComplete: MissingAccountScopeEdge extends never ? true : never = true;
void accountScopeEdgesAreComplete;

/** Missing-table compatibility is safe only when no returned child points into that table. */
export function referencedMissingTables(record: Record<string, unknown>, missingKeys: readonly string[]): string[] {
  return missingKeys.filter((key) =>
    FK_EDGES.some((edge) => edge.parent === key && rowsReference(record, edge.child, edge.field)),
  );
}
