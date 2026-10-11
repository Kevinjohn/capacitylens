import type {
  AppData,
  Entity,
  Resource,
  ResourceEngagement,
  ScopedEntityKey,
} from "@capacitylens/shared/types/entities";

// A Draft drops the server-owned fields (id/timestamps) and `accountId`, the
// store stamps the active account, so callers never supply it.
//
// It also drops `builtin` (a field only `Client` carries, `Omit` is a harmless no-op on every other
// entity): the built-in "Internal" client is minted exclusively by the privileged seed / addAccount /
// migrate paths, which construct the full Client record directly, not via addClient/updateClient.
// Public CRUD must not be able to create a second builtin or promote a normal client to one, that
// would break the "exactly one Internal per account" invariant the scheduler / migrate / import all
// rely on. Excluding the field at the type level is the guard; the store also strips it defensively at
// runtime (see addClient/updateClient).
type DraftFields<T extends Entity> = Omit<T, "id" | "accountId" | "createdAt" | "updatedAt" | "builtin">;
type ResourceDraft = Omit<DraftFields<Resource>, "engagement"> & {
  engagement?: ResourceEngagement;
};
/** Draft entity fields accepted by public create and update actions. */
export type Draft<T extends Entity> = T extends Resource ? ResourceDraft : DraftFields<T>;
// Updates use an explicit `undefined` value to remove optional entity fields. Under
// exactOptionalPropertyTypes that is distinct from omitting the patch key, so model the existing
// runtime contract directly instead of making callers disguise a removal as absence.
/** Partial draft fields, with `undefined` available to remove optional values. */
export type Patch<T extends Entity> = {
  [K in keyof Draft<T>]?: object extends Pick<Draft<T>, K> ? Draft<T>[K] | undefined : Draft<T>[K];
};

/** A row type selected from an account-scoped entity table. */
export type ScopedRow<K extends ScopedEntityKey> = AppData[K][number];
/** Mutable fields for one account-scoped table row. */
export type ScopedPatch<K extends ScopedEntityKey> = {
  [P in keyof Omit<ScopedRow<K>, keyof Entity>]?: object extends Pick<Omit<ScopedRow<K>, keyof Entity>, P>
    ? Omit<ScopedRow<K>, keyof Entity>[P] | undefined
    : Omit<ScopedRow<K>, keyof Entity>[P];
};

// The entity tables that carry the lifecycle tombstones (`archivedAt`/`deletedAt`) and so
// can travel the Active → Archived → Soft-deleted → Purged machine (`shared/src/domain/lifecycle.ts`).
// Mirrors the server's lifecycle-route entity union so the local store actions below and the server's
// dedicated routes operate over the identical set. Phases/allocations/timeOff/disciplines/
// accounts have no tombstone and are deliberately excluded.
/** Entity tables that participate in the archive, delete, and purge lifecycle. */
export type LifecycleEntity = "resources" | "clients" | "projects" | "activities";
