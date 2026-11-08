import { randomUUID } from 'node:crypto';
import type { HttpContext } from '@adonisjs/core/http';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import {
  E_IDEMPOTENCY_CONFLICT,
  E_INVALID_COMMAND_VALUE,
  executeIn,
  type ExecuteInput,
  type Operation,
} from '@kevinjohn/adonisjs-idempotency';
import {
  isAccountCommandId,
  isAccountIdempotencyKey,
} from '@capacitylens/shared/account/validation';

export interface AccountCommandIdentity {
  commandId: string;
  idempotencyKey: string;
}

export class AccountCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

/** Parses the existing paired account-command headers, minting both for older callers. */
export function readAccountCommand(ctx: HttpContext): AccountCommandIdentity {
  const commandId = ctx.request.header('x-account-command-id');
  const idempotencyKey = ctx.request.header('idempotency-key');
  if (commandId === undefined && idempotencyKey === undefined) {
    return { commandId: randomUUID(), idempotencyKey: randomUUID() };
  }
  if (!isAccountCommandId(commandId) || !isAccountIdempotencyKey(idempotencyKey)) {
    throw new AccountCommandError('Invalid or unpaired command headers.', 400, 'VALIDATION_FAILED');
  }
  return { commandId, idempotencyKey };
}

/** Adapts package refusals to the existing account-command HTTP contract. */
export function toAccountCommandError(error: unknown): unknown {
  if (error instanceof E_IDEMPOTENCY_CONFLICT) {
    return new AccountCommandError('Command identity already used.', 409, 'IDEMPOTENCY_CONFLICT');
  }
  if (error instanceof E_INVALID_COMMAND_VALUE) {
    return new AccountCommandError('Invalid command payload.', 400, 'VALIDATION_FAILED');
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
    throw toAccountCommandError(error);
  }
}
