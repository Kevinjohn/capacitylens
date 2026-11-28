import { inject } from '@adonisjs/core'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import { buildDefaultCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays'
import { FALLBACK_PRESET_COLOR } from '@capacitylens/shared/lib/color'
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields'
import Client from '#models/client'
import Company from '#models/company'
import { rowAttributes } from '#services/models/row_attributes'
import { InitialCompanyAccessService } from '#services/initial_company_access_service'

/** The complete first company and its defaults. */
@inject()
export class InitialCompanyDefaultsService {
  #initialCompanyAccess: InitialCompanyAccessService

  constructor(initialCompanyAccess: InitialCompanyAccessService) {
    this.#initialCompanyAccess = initialCompanyAccess
  }

  /** Writes the complete first company inside the caller's transaction. */
  async createInitialCompany(
    trx: TransactionClientContract,
    input: {
      name: string
      ownerId: string
      actorId: string | null
      weekStartsOn?: 0 | 1
      timezone?: string
      now?: string
    }
  ) {
    const name = input.name
    const companyId = crypto.randomUUID()
    const now = input.now ?? new Date().toISOString()
    await Company.create(
      rowAttributes(Company, {
        ...NULLABLE_FIELDS.companies,
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
      }),
      { client: trx }
    )
    await Client.create(rowAttributes(Client, buildInternalClient(companyId, now)), {
      client: trx,
    })
    await this.#initialCompanyAccess.initializeCompanyAccess(trx, {
      companyId,
      ownerId: input.ownerId,
      actorId: input.actorId,
      now,
    })

    return { companyId, ownerId: input.ownerId }
  }
}
