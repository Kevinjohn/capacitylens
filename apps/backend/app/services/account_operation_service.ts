// Account operations record receipts with `@kevinjohn/adonisjs-duplicate-request-guard`
// (`request_receipts`). The wire contract keeps the standard `Idempotency-Key` header, and
// CapacityLens's own names follow it (`idempotencyKey`, `isAccountIdempotencyKey`,
// `IDEMPOTENCY_CONFLICT`); only values passed to the package use its `requestKey` name.

import ValidationRefusalException from '#exceptions/validation_refusal_exception'
import { randomUUID } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  E_DUPLICATE_REQUEST_CONFLICT,
  E_INVALID_COMMAND_VALUE,
  executeIn,
  type ExecuteInput,
  type Operation,
} from '@kevinjohn/adonisjs-duplicate-request-guard'
import IdempotencyConflictException from '#exceptions/idempotency_conflict_exception'

export interface AccountOperationIdentity {
  commandId: string
  requestKey: string
}

/** Account operation headers, receipts and their HTTP errors. */
export class AccountOperationService {
  /**
   * The paired account-operation headers (`X-Account-Operation-Id`, `Idempotency-Key`), which the
   * validator accepts only together, minting both for a caller that sends neither, as the browser
   * does.
   */
  resolveAccountOperation(
    commandId: string | undefined,
    requestKey: string | undefined
  ): AccountOperationIdentity {
    if (commandId === undefined || requestKey === undefined) {
      return { commandId: randomUUID(), requestKey: randomUUID() }
    }
    return { commandId, requestKey }
  }

  /** Adapts package refusals to the existing account-operation HTTP contract. */
  mapAccountOperationError(error: unknown): unknown {
    if (error instanceof E_DUPLICATE_REQUEST_CONFLICT) {
      return new IdempotencyConflictException()
    }
    if (error instanceof E_INVALID_COMMAND_VALUE) {
      return new ValidationRefusalException('Invalid operation payload.')
    }
    return error
  }

  /** Runs an account operation in the caller's transaction and preserves its HTTP errors. */
  async runAccountOperation<Payload, Authorization, Result>(
    trx: TransactionClientContract,
    input: Operation<Payload, Authorization, Result> & ExecuteInput<Payload>
  ): Promise<Result> {
    try {
      const outcome = await executeIn(trx, input, input)
      return outcome.result
    } catch (error) {
      // Translate package refusals; other failures retain their identity for rollback and reporting.
      throw this.mapAccountOperationError(error)
    }
  }
}
