import db from '@adonisjs/lucid/services/db';

export const companyIds = { dc: 'a-studio', marvel: 'a-loft' } as const;
export const stamp = '2026-10-12T00:00:00.000Z';

export const scopedTables = [
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'time_off',
  'closures',
] as const;

export async function rowCount(table: string, where: Record<string, string>) {
  const result = await db.from(table).where(where).count('* as count').first();
  return Number(result?.count ?? 0);
}
