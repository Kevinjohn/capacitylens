import type { Route } from '@capacitylens/backend/registry';

/**
 * Planning wire types derived from the generated route registry. The backend Vine validator stays
 * the only runtime schema; these aliases only name what the generated declarations already carry.
 *
 * The generated body is the validator's input type, so the intent admits everything the server
 * accepts, including numeric and boolean fields supplied as strings. The browser builds intents
 * with real numbers and booleans; the server validates and normalizes every one, and a wrongly
 * typed field is refused there rather than caught here.
 *
 * The frontend constructs typed intents with real numbers and booleans; the server validator
 * remains authoritative for every persisted mutation.
 */
type PlanningMutationBody = Route.Body<'api.planning.mutate'>;

/** Execution metadata the browser only ever holds as server-issued integers. */
type ServerIssuedIntegers = Pick<
  PlanningMutationBody,
  'baseRevision' | 'confirmedRestorationCount'
>;

/**
 * The intents the browser sends. The server still accepts a restoration-group intent, but Undo
 * and Redo now go through their own routes and nothing in the browser builds one.
 */
export type PlanningIntent = Exclude<
  PlanningMutationBody['intent'],
  { operation: 'planning.restoreGroup' }
>;

export type PlanningExecution = Omit<
  PlanningMutationBody,
  keyof ServerIssuedIntegers | 'intent'
> & {
  [Field in keyof ServerIssuedIntegers]: Extract<ServerIssuedIntegers[Field], number>;
} & { intent: PlanningIntent };

/**
 * Refusals are sent through the response object, so the generated reply also admits `void`. A
 * success arrives inside the `{ data }` envelope.
 */
export type PlanningMutationSuccess = Extract<
  Exclude<Route.Response<'api.planning.mutate'>, void>['data'],
  { status: 'committed' }
>;

/** Who the last accepted planning read was for, and what that member may do and see. */
export type PlanningAccess = Exclude<
  Route.Response<'api.planning.show'>,
  void
>['data']['authority'];
