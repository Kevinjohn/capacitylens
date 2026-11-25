import ProductException from '#exceptions/product_exception';
import type { PlanningMutationErrorCode } from '#validators/planning/contracts';

/**
 * A safe refusal whose caller must roll back the enclosing planning transaction. Each cause is a
 * subclass that states its status and code.
 */
export default class PlanningOperationException extends ProductException {
  declare readonly code?: PlanningMutationErrorCode;
}
