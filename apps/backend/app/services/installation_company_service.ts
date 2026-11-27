// This service is the one-company rule's single server home. Every server check of the company
// limit, or of whether a company exists yet, reads through its methods.

import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import MultipleCompaniesException from '#exceptions/multiple_companies_exception'
import Company from '#models/company'
import User from '#models/user'

/** The installation's company and identity counts, read through the caller's client when given. */
export class InstallationCompanyService {
  /** Whether the installation holds more than one company, which only seeded development data does. */
  async hasMultipleCompanies(client?: QueryClientContract): Promise<boolean> {
    const rows = await Company.query({ client }).select('id').limit(2)
    return rows.length > 1
  }

  /** Whether first-company setup has not happened yet. */
  async hasNoCompany(client?: QueryClientContract): Promise<boolean> {
    return !(await Company.query({ client }).select('id').first())
  }

  /**
   * The installation's single company, or null before first setup.
   * @throws MultipleCompaniesException 409 `MULTIPLE_COMPANIES` when a second company exists.
   */
  async getInstallationCompanyId(client?: QueryClientContract): Promise<string | null> {
    const rows = await Company.query({ client }).select('id').limit(2)
    // Only seeded development data holds two companies; say so rather than fail with a 500.
    if (rows.length > 1) {
      throw new MultipleCompaniesException()
    }
    return rows[0] ? String(rows[0].id) : null
  }

  /** The installation's single company and its name, both null before first setup. */
  async getInstallationCompany(client?: QueryClientContract) {
    const companyId = await this.getInstallationCompanyId(client)
    const company = companyId
      ? await Company.query({ client }).where('id', companyId).select('name').first()
      : null
    return { companyId, companyName: company?.name ?? null }
  }

  /** Whether any identity exists yet; before the first one, sign-in offers setup instead. */
  async hasAnyIdentity(client?: QueryClientContract): Promise<boolean> {
    return Boolean(await User.query({ client }).select('id').first())
  }
}
