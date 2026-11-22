import { PlanningOperationException } from '#exceptions/planning_operation_exception';

/** The caller's history holds no step in that direction; nothing was attempted or refused. */
export class EmptyHistoryException extends PlanningOperationException {
  constructor(message: string) {
    super(409, null, message);
  }
}
