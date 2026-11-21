import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import { buildDefaultCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays';
import { FALLBACK_PRESET_COLOR } from '@capacitylens/shared/lib/color';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { encodeRow } from '#services/state_repository';
import { initializeCompanyAccess } from '#services/initial_company_access';

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
  const companyId = crypto.randomUUID();
  const now = input.now ?? new Date().toISOString();
  await trx.table('accounts').insert(
    encodeRow('accounts', {
      ...NULLABLE_FIELDS.accounts,
      id: companyId,
      name,
      color: FALLBACK_PRESET_COLOR,
      schedulingMode: 'days',
      weekStartsOn: input.weekStartsOn ?? 1,
      timezone: input.timezone ?? 'Etc/GMT',
      workingDays: buildDefaultCompanyWorkingDays(input.weekStartsOn),
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
        buildInternalClient(companyId, now) as unknown as Record<string, unknown>
      )
    );
  await initializeCompanyAccess(trx, {
    companyId,
    ownerId: input.ownerId,
    actorId: input.actorId,
    now,
  });

  return { companyId, ownerId: input.ownerId };
}
