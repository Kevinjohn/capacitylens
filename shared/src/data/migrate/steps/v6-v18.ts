import { normalizeAccountWorkingDays } from "../../../lib/accountWorkingDays";

// v6 → v7 added optional `isPrivate` / `codeName` fields to clients and projects. No transform is
// needed: absence is deliberately the public default, and the import sanitiser repairs malformed
// present values after migration. Keeping the version step explicit documents why v7 is structural
// metadata only rather than an omitted migration.
export function migrateV6toV7(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

// v7 → v8 added Account.internalColourMode. No transform is needed: absence deliberately means
// grey, and sanitizeAccount drops malformed present values at the server boundary.
export function migrateV7toV8(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

// v8 → v9 added the optional per-account schedule view prefs showInternalProjects /
// showInternalActivities / inlineActivityCreateEnabled. No transform is needed: absence deliberately
// reads as true (shown/enabled) at the `?? true` read sites, and sanitizeAccount drops malformed
// present values at the server boundary — exactly the v7→v8 precedent.
export function migrateV8toV9(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

// v9 → v10 added optional Resource.isFavourite. No transform is needed: legacy resources with no
// value deliberately read as not favourite, while import sanitisation rejects malformed values.
export function migrateV9toV10(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

// v10 → v11 adds required Resource.halfDays. Every previously selected working day was a full day,
// so legacy resources receive an empty subset and every unselected weekday remains non-working.
// Bare server slices do not carry an export schemaVersion and therefore pass through every portable
// migration on hydration. Preserve an already-present value so current server data is not mistaken
// for a legacy export and reset on every fresh session.
export function migrateV10toV11(data: Record<string, unknown>): Record<string, unknown> {
  const resources = Array.isArray(data.resources)
    ? data.resources.map((resource) => {
        if (!resource || typeof resource !== "object") return resource;
        const record = resource as Record<string, unknown>;
        return Array.isArray(record.halfDays) ? record : { ...record, halfDays: [] };
      })
    : data.resources;
  return { ...data, resources };
}

// v11 → v12 adds required Resource.engagement. Existing people, placeholders and external rows all
// start as Studio; later edits can explicitly classify people as Supplementary. As above, a bare
// current server slice is versionless, so valid current classifications must survive this step.
export function migrateV11toV12(data: Record<string, unknown>): Record<string, unknown> {
  const resources = Array.isArray(data.resources)
    ? data.resources.map((resource) => {
        if (!resource || typeof resource !== "object") return resource;
        const record = resource as Record<string, unknown>;
        return record.engagement === "studio" || record.engagement === "supplementary"
          ? record
          : { ...record, engagement: "studio" };
      })
    : data.resources;
  return { ...data, resources };
}

// v12 → v13 adds optional Account.groupResourcesByEngagement. No transform is needed: absence
// deliberately reads as true, and sanitizeAccount drops malformed present values.
export function migrateV12toV13(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

// v13 → v14 adds account-wide working weekdays. Backfill the first five days of each account's
// configured week; malformed present values take the same repair path as a direct server write.
export function migrateV13toV14(data: Record<string, unknown>): Record<string, unknown> {
  const accounts = Array.isArray(data.accounts)
    ? data.accounts.map((account) => {
        if (!account || typeof account !== "object") return account;
        const record = account as Record<string, unknown>;
        const weekStartsOn = record.weekStartsOn === 0 ? 0 : 1;
        return {
          ...record,
          workingDays: normalizeAccountWorkingDays(record.workingDays, weekStartsOn),
        };
      })
    : data.accounts;
  return { ...data, accounts };
}

// v14 → v15 introduces optional repeat-series identity. Existing repeated allocations were
// independent rows with no durable evidence of which creation batch produced them, so forward-only
// migration deliberately leaves every legacy allocation unlinked.
export function migrateV14toV15(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

// v15 → v16 widens TimeOff.resourceId to nullable so one row can represent company-wide time
// off. Existing personal rows already have the current shape and remain byte-for-byte unchanged.
export function migrateV15toV16(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}
