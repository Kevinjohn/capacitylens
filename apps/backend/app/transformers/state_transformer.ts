import type { AppData, ScopedEntityKey } from '@capacitylens/shared/types/entities';
import type { Role } from '@capacitylens/shared/account/types';
import { canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access';
import { displayNameOf, projectForReader } from '#services/planning/restricted_fields';

export function transformState(data: AppData, accountId: string | undefined, role: Role): AppData {
  const capabilities = {
    canSeePrivateNames: canSeePrivateNames(role),
    canSeeTimeOffNote: canSeeTimeOffNote(role),
  };
  const scoped = <K extends ScopedEntityKey>(table: K) =>
    (accountId ? data[table].filter((row) => row.accountId === accountId) : data[table]).map(
      (row) => projectForReader(table, capabilities, row)
    ) as AppData[K];
  // Each client and project carries the label its reader orders by, decided here once.
  const named = <K extends 'clients' | 'projects'>(table: K) =>
    scoped(table).map((row) => ({ ...row, displayName: displayNameOf(row) })) as AppData[K];
  return {
    accounts: accountId ? data.accounts.filter((row) => row.id === accountId) : data.accounts,
    clients: named('clients'),
    disciplines: scoped('disciplines'),
    projects: named('projects'),
    phases: scoped('phases'),
    resources: scoped('resources'),
    activities: scoped('activities'),
    allocations: scoped('allocations'),
    timeOff: scoped('timeOff'),
    closures: scoped('closures'),
  };
}
