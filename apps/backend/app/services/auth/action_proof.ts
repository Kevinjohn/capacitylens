import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { activeCompanyRole } from './authorization.js';
import { actorIn, type CurrentActor } from './current_actor.js';

export const ACTION_PROOF_KINDS = ['transfer-ownership', 'import', 'anonymise'] as const;
export type ActionProofKind = (typeof ACTION_PROOF_KINDS)[number];

export class ActionProofError extends Error {
  readonly status = 403;
  readonly code = 'ACTION_PROOF_REQUIRED';
  constructor(message = 'Confirm this action again.') {
    super(message);
  }
}

/** Resolves live Owner authority for a proof request or spend inside `withActor`. */
export async function actionProofActor(
  accountId: string,
  trx: TransactionClientContract
): Promise<CurrentActor> {
  const actor = actorIn(trx);
  if (actor.masqueradeContext?.isMasquerading) throw new ActionProofError();
  if (!(await trx.from('accounts').where('id', accountId).select('id').first())) {
    throw new ActionProofError();
  }
  if ((await activeCompanyRole(actor.userId, accountId, trx)) !== 'owner') {
    throw new ActionProofError();
  }
  return actor;
}
