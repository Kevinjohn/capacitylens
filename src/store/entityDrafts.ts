import type {
  AppData,
  Entity,
  Resource,
  ResourceEngagement,
  ScopedEntityKey,
} from "@capacitylens/shared/types/entities";

// A Draft drops the server-owned fields (id/timestamps) AND `accountId` — the
// store stamps the active account, so callers never supply it.
//
// It ALSO drops `builtin` (a field only `Client` carries — `Omit` is a harmless no-op on every other
// entity): the built-in "Internal" client is minted exclusively by the privileged seed / addAccount /
// migrate paths, which construct the full Client record directly, NOT via addClient/updateClient.
// Public CRUD must NOT be able to create a SECOND builtin or promote a normal client to one — that
// would break the "exactly one Internal per account" invariant the scheduler / migrate / import all
// rely on. Excluding the field at the type level is the guard; the store also strips it defensively at
// runtime (see addClient/updateClient).
type DraftFields<T extends Entity> = Omit<T, "id" | "accountId" | "createdAt" | "updatedAt" | "builtin">;
type ResourceDraft = Omit<DraftFields<Resource>, "engagement"> & {
  engagement?: ResourceEngagement;
};
export type Draft<T extends Entity> = T extends Resource ? ResourceDraft : DraftFields<T>;
// Updates use an explicit `undefined` value to remove optional entity fields. Under
// exactOptionalPropertyTypes that is distinct from omitting the patch key, so model the existing
// runtime contract directly instead of making callers disguise a removal as absence.
export type Patch<T extends Entity> = {
  [K in keyof Draft<T>]?: object extends Pick<Draft<T>, K> ? Draft<T>[K] | undefined : Draft<T>[K];
};

/** One row of a scoped table, and the patch shape accepted for it (server-owned fields excluded). */
export type ScopedRow<K extends ScopedEntityKey> = AppData[K][number];
export type ScopedPatch<K extends ScopedEntityKey> = {
  [P in keyof Omit<ScopedRow<K>, keyof Entity>]?: object extends Pick<Omit<ScopedRow<K>, keyof Entity>, P>
    ? Omit<ScopedRow<K>, keyof Entity>[P] | undefined
    : Omit<ScopedRow<K>, keyof Entity>[P];
};

// The three entity tables that carry the lifecycle tombstones (`archivedAt`/`deletedAt`, P2.1) and so
// can travel the Active → Archived → Soft-deleted → Purged machine (`shared/src/domain/lifecycle.ts`).
// MIRRORS the server's lifecycle-route entity union so the LOCAL store actions below and the server's
// dedicated routes (P2.5a) operate over the IDENTICAL set — phases/activities/allocations/timeOff/
// disciplines/accounts have no tombstone and are deliberately excluded.
export type LifecycleEntity = "resources" | "clients" | "projects";
