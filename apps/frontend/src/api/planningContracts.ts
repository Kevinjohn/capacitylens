import type { Route } from '@capacitylens/backend/registry';

/**
 * Planning wire types derived from the generated route registry. The backend Vine validator stays
 * the only runtime schema; these aliases only name what the generated declarations already carry.
 *
 * The generated body is the validator's input type, so the intent admits everything the server
 * accepts, including numeric and boolean fields supplied as strings. The browser builds intents
 * with real numbers and booleans; the server validates and normalizes every one, and a wrongly
 * typed field is refused there rather than caught here.
 */
type PlanningMutationBody = Route.Body<'api.planning.restoreGroup'>;

/** Execution metadata the browser only ever holds as server-issued integers. */
type ServerIssuedIntegers = Pick<
  PlanningMutationBody,
  'baseRevision' | 'confirmedRestorationCount'
>;

export type PlanningExecution = Omit<PlanningMutationBody, keyof ServerIssuedIntegers> & {
  [Field in keyof ServerIssuedIntegers]: Extract<ServerIssuedIntegers[Field], number>;
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
