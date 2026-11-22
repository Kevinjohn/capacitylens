import type { AppDataKey } from '@capacitylens/shared/types/entities';

/** The one map from each AppData key to its SQL table; every product-table lookup uses it. */
export const tables = {
  companies: 'companies',
  clients: 'clients',
  disciplines: 'disciplines',
  projects: 'projects',
  phases: 'phases',
  resources: 'resources',
  activities: 'activities',
  allocations: 'allocations',
  timeOff: 'time_off',
  closures: 'closures',
} as const satisfies Record<AppDataKey, string>;
export type ProductTable = (typeof tables)[keyof typeof tables];
