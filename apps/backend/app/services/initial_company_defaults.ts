import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import { defaultAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays';
import { FALLBACK_PRESET_COLOR } from '@capacitylens/shared/lib/color';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { encodeRow } from '#services/state_repository';
import { establishInitialCompanyAuthority } from '#services/initial_company_authority';

/** Writes the complete first company inside the caller's transaction. */
export async function createInitialCompany(
  trx: TransactionClientContract,
  input: {
    name: string;
    ownerId: string;
    actorId: string | null;
    weekStartsOn?: 0 | 1;
    timezone?: string;
    now?: string;
  }
) {
  const name = input.name;
  const accountId = crypto.randomUUID();
  const now = input.now ?? new Date().toISOString();
  await trx.table('accounts').insert(
    encodeRow('accounts', {
      ...NULLABLE_FIELDS.accounts,
      id: accountId,
      name,
      color: FALLBACK_PRESET_COLOR,
      schedulingMode: 'days',
      weekStartsOn: input.weekStartsOn ?? 1,
      timezone: input.timezone ?? 'Etc/GMT',
      workingDays: defaultAccountWorkingDays(input.weekStartsOn),
      disciplinesEnabled: false,
      placeholdersEnabled: false,
      externalEnabled: false,
      inlineActivityCreateEnabled: false,
      createdAt: now,
      updatedAt: now,
    })
  );
  await trx
    .table('clients')
    .insert(
      encodeRow(
        'clients',
        buildInternalClient(accountId, now) as unknown as Record<string, unknown>
      )
    );
  await establishInitialCompanyAuthority(trx, {
    accountId,
    ownerId: input.ownerId,
    actorId: input.actorId,
    now,
  });

  return { accountId, ownerId: input.ownerId };
}
