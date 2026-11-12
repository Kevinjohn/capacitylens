import type { TransactionClientContract } from '@adonisjs/lucid/types/database';

/** Whether the company has dismissed its getting-started panel. */
export async function isGettingStartedDismissed(trx: TransactionClientContract, accountId: string) {
  const row = await trx
    .from('account_getting_started_dismissals')
    .where('account_id', accountId)
    .first();
  return Boolean(row);
}

/** Records the company's dismissal once; a repeat is ignored. */
export async function dismissGettingStarted(
  trx: TransactionClientContract,
  accountId: string,
  now: string
) {
  await trx
    .table('account_getting_started_dismissals')
    .insert({
      id: crypto.randomUUID(),
      account_id: accountId,
      created_at: now,
      updated_at: now,
    })
    .onConflict('account_id')
    .ignore();
}
