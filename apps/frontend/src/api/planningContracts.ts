import type { Route } from '@capacitylens/backend/registry';

/**
 * Planning wire types derived from the generated route registry. The backend Vine validator stays
 * the only runtime schema; these aliases only name what the generated declarations already carry.
 */
type PlanningMutationBody = Route.Body<'api.planning.restoreGroup'>;

/**
 * The generated body is the validator's input type, which also admits numeric strings. The browser
 * only ever holds server-issued integers for these two fields, so it narrows them to numbers.
 */
export type PlanningExecution = PlanningMutationBody & {
  baseRevision: number;
  confirmedRestorationCount?: number;
};
export type PlanningIntent = PlanningMutationBody['intent'];

/** Refusals are sent through the response object, so the generated reply also admits `void`. */
export type PlanningMutationSuccess = Extract<
  Route.Response<'api.planning.restoreGroup'>,
  { status: 'committed' }
>;
export type PlanningMutationLookup = Exclude<Route.Response<'api.planning.lookup'>, void>;

/** A history entry stores ordinary inputs; every Undo and Redo gets new execution metadata. */
export interface PlanningHistoryEntry<TIntent = PlanningIntent> {
  forward: TIntent;
  inverse: TIntent;
}
