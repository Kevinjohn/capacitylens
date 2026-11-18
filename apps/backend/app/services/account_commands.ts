// Account commands record receipts with `@kevinjohn/adonisjs-duplicate-request-guard`
// (`request_receipts`). The wire contract keeps the standard `Idempotency-Key` header, and
// CapacityLens's own names follow it (`idempotencyKey`, `isAccountIdempotencyKey`,
// `IDEMPOTENCY_CONFLICT`); only values passed to the package use its `requestKey` name.

import { RefusalError } from '#exceptions/refusal_error';
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

export interface AccountCommandIdentity {
  commandId: string;
  requestKey: string;
}

export class AccountCommandError extends RefusalError {}

/**
 * Parses the paired account-command headers (`X-Account-Command-Id`, `Idempotency-Key`), minting
 * both for older callers that send neither.
 */
export function parseAccountCommand(
  commandId: string | undefined,
  requestKey: string | undefined
): AccountCommandIdentity {
  if (commandId === undefined && requestKey === undefined) {
    return { commandId: randomUUID(), requestKey: randomUUID() };
  }
  if (!isAccountCommandId(commandId) || !isAccountIdempotencyKey(requestKey)) {
    throw new AccountCommandError('Invalid or unpaired command headers.', 400, 'VALIDATION_ERROR');
  }
  return { commandId, requestKey };
}

/** Adapts package refusals to the existing account-command HTTP contract. */
export function mapAccountCommandError(error: unknown): unknown {
  if (error instanceof E_DUPLICATE_REQUEST_CONFLICT) {
    return new AccountCommandError('Command identity already used.', 409, 'IDEMPOTENCY_CONFLICT');
  }
  if (error instanceof E_INVALID_COMMAND_VALUE) {
    return new AccountCommandError('Invalid command payload.', 400, 'VALIDATION_ERROR');
  }
  return error;
}

/** Runs a command in the caller's transaction and preserves the account-command HTTP errors. */
export async function runAccountCommand<Payload, Authorization, Result>(
  trx: TransactionClientContract,
  input: Operation<Payload, Authorization, Result> & ExecuteInput<Payload>
): Promise<Result> {
  try {
    const outcome = await executeIn(trx, input, input);
    return outcome.result;
  } catch (error) {
    // Translate package refusals; other failures retain their identity for rollback and reporting.
    throw mapAccountCommandError(error);
  }
}
