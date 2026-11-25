// This service is the one-company rule's single server home. Every server check of the company
// limit, or of whether a company exists yet, reads through its methods.

import type { Trx } from '@kevinjohn/adonisjs-account-kit/types';
import { MultipleCompaniesException } from '#exceptions/admission_exception';

type CompanyReader = Pick<Trx, 'from'>;

/** The installation's company and identity counts, read through the caller's connection. */
export class InstallationCompanyService {
  /** Whether the installation holds more than one company, which only seeded development data does. */
  async hasMultipleCompanies(reader: CompanyReader): Promise<boolean> {
    const rows = await reader.from('companies').select('id').limit(2);
    return rows.length > 1;
  }

  /** Whether first-company setup has not happened yet. */
  async hasNoCompany(reader: CompanyReader): Promise<boolean> {
    return !(await reader.from('companies').first());
  }

  /**
   * The installation's single company, or null before first setup.
   * @throws MultipleCompaniesException 409 `MULTIPLE_COMPANIES` when a second company exists.
   */
  async getInstallationCompanyId(reader: CompanyReader): Promise<string | null> {
    const rows = await reader.from('companies').select('id').limit(2);
    // Only seeded development data holds two companies; say so rather than fail with a 500.
    if (rows.length > 1) {
      throw new MultipleCompaniesException();
    }
    return rows[0] ? String(rows[0].id) : null;
  }

  /** The installation's single company and its name, both null before first setup. */
  async getInstallationCompany(reader: CompanyReader) {
    const companyId = await this.getInstallationCompanyId(reader);
    const company = companyId
      ? await reader.from('companies').where('id', companyId).select('name').first()
      : null;
    return { companyId, companyName: (company?.name as string | undefined) ?? null };
  }

  /** Whether any identity exists yet; before the first one, sign-in offers setup instead. */
  async hasAnyIdentity(reader: CompanyReader): Promise<boolean> {
    return Boolean(await reader.from('users').select('id').first());
  }
}
