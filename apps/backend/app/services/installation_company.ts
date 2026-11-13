import type { Trx } from '@kevinjohn/adonisjs-account-kit/types';
import { AdmissionError } from '#services/admission/errors';

type CompanyReader = Pick<Trx, 'from'>;

/** Whether the installation holds more than one company, which only seeded development data does. */
export async function hasMultipleCompanies(reader: CompanyReader): Promise<boolean> {
  const rows = await reader.from('accounts').select('id').limit(2);
  return rows.length > 1;
}

/** Whether first-company setup has not happened yet. */
export async function hasNoCompany(reader: CompanyReader): Promise<boolean> {
  return !(await reader.from('accounts').select('id').first());
}

/**
 * The installation's single company, or null before first setup.
 * @throws AdmissionError 409 `MULTIPLE_COMPANIES` when a second company exists.
 */
export async function installationCompanyId(reader: CompanyReader): Promise<string | null> {
  const rows = await reader.from('accounts').select('id').limit(2);
  // Only seeded development data holds two companies; say so rather than fail with a 500.
  if (rows.length > 1) {
    throw new AdmissionError(
      'This installation has more than one company. Accounts need a single-company database.',
      409,
      'MULTIPLE_COMPANIES'
    );
  }
  return rows[0] ? String(rows[0].id) : null;
}
