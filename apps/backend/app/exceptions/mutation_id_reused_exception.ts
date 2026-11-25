import PlanningOperationException from '#exceptions/planning_operation_exception';

/** The mutation identity already committed a different mutation. */
export default class MutationIdReusedException extends PlanningOperationException {
  static status = 409;
  static code = 'MUTATION_ID_REUSED';
  static message = 'This mutation identity has already committed.';
}
