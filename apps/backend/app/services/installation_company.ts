// This module is the one-company rule's single server home. Every server check of the company
// limit, or of whether a company exists yet, reads through these functions.

import type { Trx } from '@kevinjohn/adonisjs-account-kit/types';
import { AdmissionException } from '#exceptions/admission_exception';

type CompanyReader = Pick<Trx, 'from'>;

/** Whether the installation holds more than one company, which only seeded development data does. */
export async function hasMultipleCompanies(reader: CompanyReader): Promise<boolean> {
  const rows = await reader.from('accounts').select('id').limit(2);
  return rows.length > 1;
}

/** Whether first-company setup has not happened yet. */
export async function hasNoCompany(reader: CompanyReader): Promise<boolean> {
  return !(await reader.from('accounts').first());
}

/**
 * The installation's single company, or null before first setup.
 * @throws AdmissionException 409 `MULTIPLE_COMPANIES` when a second company exists.
 */
export async function getInstallationCompanyId(reader: CompanyReader): Promise<string | null> {
  const rows = await reader.from('accounts').select('id').limit(2);
  // Only seeded development data holds two companies; say so rather than fail with a 500.
  if (rows.length > 1) {
    throw new AdmissionException(
      'This installation has more than one company. Accounts need a single-company database.',
      409,
      'MULTIPLE_COMPANIES'
    );
  }
  return rows[0] ? String(rows[0].id) : null;
}

/** The installation's single company and its name, both null before first setup. */
export async function getInstallationCompany(reader: CompanyReader) {
  const companyId = await getInstallationCompanyId(reader);
  const company = companyId
    ? await reader.from('accounts').where('id', companyId).select('name').first()
    : null;
  return { companyId, accountName: (company?.name as string | undefined) ?? null };
}

/** Whether any identity exists yet; before the first one, sign-in offers setup instead. */
export async function hasAnyIdentity(reader: CompanyReader): Promise<boolean> {
  return Boolean(await reader.from('users').select('id').first());
}
