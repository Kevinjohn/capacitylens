// Account operations record receipts with `@kevinjohn/adonisjs-duplicate-request-guard`
// (`request_receipts`). The wire contract keeps the standard `Idempotency-Key` header, and
// CapacityLens's own names follow it (`idempotencyKey`, `isAccountIdempotencyKey`,
// `IDEMPOTENCY_CONFLICT`); only values passed to the package use its `requestKey` name.

import { AccountOperationException } from '#exceptions/account_operation_exception';
import { randomUUID } from 'node:crypto';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import {
  E_DUPLICATE_REQUEST_CONFLICT,
  E_INVALID_COMMAND_VALUE,
  executeIn,
  type ExecuteInput,
  type Operation,
} from '@kevinjohn/adonisjs-duplicate-request-guard';
import {
  isAccountCommandId,
  isAccountIdempotencyKey,
} from '@capacitylens/shared/account/validation';

export interface AccountOperationIdentity {
  commandId: string;
  requestKey: string;
}

/**
 * Parses the paired account-operation headers (`X-Account-Operation-Id`, `Idempotency-Key`), minting
 * both for older callers that send neither.
 */
export function parseAccountOperation(
  commandId: string | undefined,
  requestKey: string | undefined
): AccountOperationIdentity {
  if (commandId === undefined && requestKey === undefined) {
    return { commandId: randomUUID(), requestKey: randomUUID() };
  }
  if (!isAccountCommandId(commandId) || !isAccountIdempotencyKey(requestKey)) {
    throw new AccountOperationException(
      'Invalid or unpaired command headers.',
      400,
      'VALIDATION_ERROR'
    );
  }
  return { commandId, requestKey };
}

/** Adapts package refusals to the existing account-operation HTTP contract. */
export function mapAccountOperationError(error: unknown): unknown {
  if (error instanceof E_DUPLICATE_REQUEST_CONFLICT) {
    return new AccountOperationException(
      'Command identity already used.',
      409,
      'IDEMPOTENCY_CONFLICT'
    );
  }
  if (error instanceof E_INVALID_COMMAND_VALUE) {
    return new AccountOperationException('Invalid command payload.', 400, 'VALIDATION_ERROR');
  }
  return error;
}

/** Runs an account operation in the caller's transaction and preserves its HTTP errors. */
export async function runAccountOperation<Payload, Authorization, Result>(
  trx: TransactionClientContract,
  input: Operation<Payload, Authorization, Result> & ExecuteInput<Payload>
): Promise<Result> {
  try {
    const outcome = await executeIn(trx, input, input);
    return outcome.result;
  } catch (error) {
    // Translate package refusals; other failures retain their identity for rollback and reporting.
    throw mapAccountOperationError(error);
  }
}
