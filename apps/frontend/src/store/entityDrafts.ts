import type { Entity, Resource, ResourceEngagement } from '@capacitylens/shared/types/entities';

// The store supplies account identity and server-owned fields. Exclude builtin from
// ordinary drafts so public CRUD cannot create or promote a second Internal client;
// runtime stripping also protects callers that bypass the type boundary.
type NullableKeys<T> = { [K in keyof T]: null extends T[K] ? K : never }[keyof T];
type DraftFields<T extends Entity> = Omit<
  T,
  'id' | 'accountId' | 'createdAt' | 'updatedAt' | 'builtin' | NullableKeys<T>
> & {
  [K in Exclude<NullableKeys<T>, 'builtin'>]?: T[K];
};
type ResourceDraft = Omit<DraftFields<Resource>, 'engagement'> & {
  engagement?: ResourceEngagement;
};
/** Draft entity fields accepted by public create and update actions. */
export type Draft<T extends Entity> = T extends Resource ? ResourceDraft : DraftFields<T>;
// Omission leaves a field untouched; an explicit undefined in a nullable draft field clears it.
/** Partial draft fields, with `undefined` available to clear nullable values. */
export type Patch<T extends Entity> = {
  [K in keyof Draft<T>]?: object extends Pick<Draft<T>, K> ? Draft<T>[K] | undefined : Draft<T>[K];
};

/** Resource and catalogue tables with archive/restore actions. Retained deletion of other planning rows is separate. */
export type LifecycleEntity = 'resources' | 'clients' | 'projects' | 'activities';
