import { BaseTransformer } from '@adonisjs/core/transformers';
import type { AppData, ScopedEntityKey } from '@capacitylens/shared/types/entities';
import type { Role } from '@capacitylens/shared/account/types';
import { canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access';
import { resolveDisplayName, projectForReader } from '#services/planning/restricted_fields';

export default class StateTransformer extends BaseTransformer<AppData> {
  #companyId: string | undefined;
  #role: Role;

  constructor(resource: AppData, companyId: string | undefined, role: Role) {
    super(resource);
    this.#companyId = companyId;
    this.#role = role;
  }

  toObject(): AppData {
    const data = this.resource;
    const companyId = this.#companyId;
    const visibilityFlags = {
      canSeePrivateNames: canSeePrivateNames(this.#role),
      canSeeTimeOffNote: canSeeTimeOffNote(this.#role),
    };
    const scoped = <K extends ScopedEntityKey>(table: K) =>
      (companyId ? data[table].filter((row) => row.companyId === companyId) : data[table]).map(
        (row) => projectForReader(table, visibilityFlags, row)
      ) as AppData[K];
    // Each client and project carries the label its reader orders by, decided here once.
    const named = <K extends 'clients' | 'projects'>(table: K) =>
      scoped(table).map((row) => ({ ...row, displayName: resolveDisplayName(row) })) as AppData[K];
    return {
      accounts: companyId ? data.accounts.filter((row) => row.id === companyId) : data.accounts,
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
}

export function transformState(data: AppData, companyId: string | undefined, role: Role): AppData {
  return new StateTransformer(data, companyId, role).toObject();
}
