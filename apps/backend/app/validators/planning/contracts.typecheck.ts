import type { Infer, SchemaTypes } from '@vinejs/vine/types';
import type {
  Account,
  Activity,
  Allocation,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities';
import type { WritableField } from '@capacitylens/shared/types/entityFields';
import type { allocationChanges } from '#validators/planning/allocation';
import type {
  activityChanges,
  clientChanges,
  disciplineChanges,
  phaseChanges,
  projectChanges,
} from '#validators/planning/catalogue';
import type { closureChanges } from '#validators/planning/closure';
import type { resourceChanges } from '#validators/planning/resource';
import type { settingsChanges } from '#validators/planning/settings';
import type { timeOffChanges } from '#validators/planning/time_off';

// Compile-time checks that each planning update schema accepts exactly the writable fields of its
// entity in the shared field table, and that each enum field infers the shared type. Nothing runs.

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type Changes<T extends SchemaTypes> = Required<Infer<T>>;
type ObjectChanges<T extends Record<string, SchemaTypes>> = Required<{
  [K in keyof T]: Infer<T[K]>;
}>;

export type PlanningChangeContracts = [
  Assert<Equal<keyof Changes<typeof allocationChanges>, WritableField<'allocations'>>>,
  Assert<Equal<keyof Changes<typeof projectChanges>, WritableField<'projects'>>>,
  Assert<Equal<keyof Changes<typeof phaseChanges>, WritableField<'phases'>>>,
  Assert<Equal<keyof Changes<typeof activityChanges>, WritableField<'activities'>>>,
  Assert<Equal<keyof Changes<typeof disciplineChanges>, WritableField<'disciplines'>>>,
  Assert<Equal<keyof Changes<typeof timeOffChanges>, WritableField<'timeOff'>>>,
  Assert<Equal<keyof ObjectChanges<typeof closureChanges>, WritableField<'closures'>>>,
  // `kind` cannot change after create.
  Assert<
    Equal<keyof ObjectChanges<typeof resourceChanges>, Exclude<WritableField<'resources'>, 'kind'>>
  >,
  // `language` is frozen at company creation.
  Assert<
    Equal<
      keyof ObjectChanges<typeof settingsChanges>,
      Exclude<WritableField<'accounts'>, 'language'>
    >
  >,
  // `builtin` is set only by the server.
  Assert<Equal<keyof Changes<typeof clientChanges>, Exclude<WritableField<'clients'>, 'builtin'>>>,
  Assert<Equal<NonNullable<Changes<typeof allocationChanges>['status']>, Allocation['status']>>,
  Assert<Equal<NonNullable<Changes<typeof activityChanges>['kind']>, Activity['kind']>>,
  Assert<Equal<NonNullable<Changes<typeof timeOffChanges>['type']>, TimeOff['type']>>,
  Assert<
    Equal<
      NonNullable<ObjectChanges<typeof resourceChanges>['employmentType']>,
      Resource['employmentType']
    >
  >,
  Assert<
    Equal<NonNullable<ObjectChanges<typeof resourceChanges>['engagement']>, Resource['engagement']>
  >,
  Assert<
    Equal<
      NonNullable<ObjectChanges<typeof settingsChanges>['schedulingMode']>,
      NonNullable<Account['schedulingMode']>
    >
  >,
  Assert<
    Equal<
      NonNullable<ObjectChanges<typeof settingsChanges>['capacityOverviewAccess']>,
      NonNullable<Account['capacityOverviewAccess']>
    >
  >,
  Assert<
    Equal<
      NonNullable<ObjectChanges<typeof settingsChanges>['dateStyle']>,
      NonNullable<Account['dateStyle']>
    >
  >,
];
