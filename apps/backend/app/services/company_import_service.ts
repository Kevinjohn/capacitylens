import { inject } from '@adonisjs/core'
import { createHash } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  CompanyExportError,
  buildCompanyExport,
  parseCompanyExport,
  prepareCompanyImport,
  type CompanyExport,
} from '@capacitylens/shared/data/companyExport'
import {
  APP_DATA_KEYS,
  SCOPED_KEYS,
  SCOPED_WRITE_ORDER,
  type AppData,
} from '@capacitylens/shared/types/entities'
import type { LucidModel, ModelObject } from '@adonisjs/lucid/types/model'
import Company from '#models/company'
import { companyRows, productModels } from '#models_support/product_models'
import { rowAttributes } from '#models_support/row_attributes'
import { StateRepositoryService } from '#services/state_repository_service'
import { tables } from '#models_support/product_tables'
import { PlanningRevisionService } from '#services/planning_revision_service'
import { AuditService } from '#services/audit_service'
import { RestorationService } from '#services/planning/restoration_service'
import { PlanningHistoryService } from '#services/planning/planning_history_service'
import EntityNotFoundException from '#exceptions/entity_not_found_exception'
import ImportIdCollisionException from '#exceptions/import_id_collision_exception'
import ImportSnapshotStaleException from '#exceptions/import_snapshot_stale_exception'

const INSERT_CHUNK_SIZE = 32
const ID_LOOKUP_CHUNK_SIZE = 200

function buildFingerprint(data: AppData) {
  const rows = APP_DATA_KEYS.map((key) => [
    key,
    [...data[key]].sort((a, b) => a.id.localeCompare(b.id)),
  ])
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

function buildPortableFingerprint(data: AppData, companyId: string) {
  return buildFingerprint(buildCompanyExport(data, { companyId, completeness: 'full' }).data)
}

/** Company export documents read from requests, and their preview and import. */
@inject()
export class CompanyImportService {
  #stateRepository: StateRepositoryService
  #audit: AuditService
  #planningRevisions: PlanningRevisionService
  #restoration: RestorationService
  #history: PlanningHistoryService

  constructor(
    stateRepository: StateRepositoryService,
    audit: AuditService,
    planningRevisions: PlanningRevisionService,
    restoration: RestorationService,
    history: PlanningHistoryService
  ) {
    this.#stateRepository = stateRepository
    this.#audit = audit
    this.#planningRevisions = planningRevisions
    this.#restoration = restoration
    this.#history = history
  }

  /**
   * Inserts rows on the model's table in multi-row statements, each value stored by the model's
   * column `prepare`, as `save()` stores it. Lucid has no bulk insert and `createMany` sends one
   * statement per row through a model instance, several times slower on the largest import. No
   * instance exists, so no model hook runs: every imported row carries the importing company.
   */
  async #insertThroughModel(
    trx: TransactionClientContract,
    model: LucidModel,
    rows: readonly object[]
  ) {
    // The product columns' prepare functions read only the value; a blank row stands in for the row.
    const blank = new model()
    for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
      const values = rows.slice(offset, offset + INSERT_CHUNK_SIZE).map((row) => {
        const attributes: ModelObject = rowAttributes(model, row)
        const stored: ModelObject = {}
        for (const [property, column] of model.$columnsDefinitions) {
          const value: unknown = attributes[property]
          stored[column.columnName] = column.prepare
            ? column.prepare(value, property, blank)
            : value
        }
        return stored
      })
      const query = model.query({ client: trx })
      query.knexQuery.insert(values)
      await query
    }
  }

  // Scheduling IDs are primary keys across every company, so a document exported from another
  // company on this server cannot be inserted while that company still holds the same rows. Refusing
  // here keeps preview and apply in agreement instead of surfacing a constraint failure after the
  // Owner has confirmed with a password.
  async #assertNoForeignIdCollision(
    trx: TransactionClientContract,
    companyId: string,
    data: AppData
  ) {
    for (const key of SCOPED_WRITE_ORDER) {
      const ids = data[key].map((row) => row.id)
      for (let offset = 0; offset < ids.length; offset += ID_LOOKUP_CHUNK_SIZE) {
        const foreign = await trx
          .from(tables[key])
          .whereIn('id', ids.slice(offset, offset + ID_LOOKUP_CHUNK_SIZE))
          .whereNot('company_id', companyId)
          .select('id')
          .first()
        if (foreign) {
          throw new ImportIdCollisionException()
        }
      }
    }
  }

  async #readImportContext(trx: TransactionClientContract, companyId: string) {
    const links = await trx
      .from('account_member_resources')
      .where('company_id', companyId)
      .select('user_id', 'resource_id')
    return {
      companyId,
      memberResourceLinks: links.map((link) => ({
        memberId: String(link.user_id),
        resourceId: String(link.resource_id),
      })),
    }
  }

  /**
   * Validates a document taken from a parsed request body, throwing a {@link CompanyExportError} that
   * names the reason when it is not a valid export. Nesting too deep to serialise is one such reason;
   * any other failure propagates.
   */
  readRequestDocument(value: unknown): CompanyExport {
    try {
      return parseCompanyExport(JSON.stringify(value))
    } catch (error) {
      if (error instanceof RangeError) {
        throw new CompanyExportError('document', 'is nested too deeply')
      }
      throw error
    }
  }

  /** Like {@link readRequestDocument}, but returns null instead of naming why the document is invalid. */
  parseRequestDocument(value: unknown): CompanyExport | null {
    try {
      return this.readRequestDocument(value)
    } catch (error) {
      if (error instanceof CompanyExportError) return null
      throw error
    }
  }

  /**
   * Validates one full document against current company links and returns its visible impact: the
   * document's company name and its row count per scoped table.
   */
  async previewCompanyImport(
    trx: TransactionClientContract,
    companyId: string,
    document: CompanyExport
  ) {
    const current = await this.#stateRepository.readStateWithClient(trx, companyId, true)
    if (current.companies.length !== 1) throw new EntityNotFoundException('Company not found.')
    const prepared = prepareCompanyImport(document, await this.#readImportContext(trx, companyId))
    await this.#assertNoForeignIdCollision(trx, companyId, prepared.data)
    const changed = buildPortableFingerprint(current, companyId) !== buildFingerprint(prepared.data)
    const baseRevision = await this.#planningRevisions.getPlanningRevision(trx, companyId)
    const company = prepared.data.companies.at(0)
    if (!company) throw new Error('A prepared beta import always carries exactly one company.')
    return {
      baseRevision,
      imported: prepared.imported,
      changed,
      companyName: company.name,
      counts: Object.fromEntries(SCOPED_KEYS.map((key) => [key, prepared.data[key].length])),
    }
  }

  /** Replaces the company slice with stable IDs; the caller owns authorization and password confirmation consumption. */
  async applyCompanyImport(
    trx: TransactionClientContract,
    companyId: string,
    document: CompanyExport,
    baseRevision: number,
    actorId: string
  ) {
    const current = await this.#stateRepository.readStateWithClient(trx, companyId, true)
    if (current.companies.length !== 1) throw new EntityNotFoundException('Company not found.')
    const revision = await this.#planningRevisions.getPlanningRevision(trx, companyId)
    if (revision !== baseRevision) {
      throw new ImportSnapshotStaleException(revision)
    }
    const prepared = prepareCompanyImport(document, await this.#readImportContext(trx, companyId))
    await this.#assertNoForeignIdCollision(trx, companyId, prepared.data)
    if (buildPortableFingerprint(current, companyId) === buildFingerprint(prepared.data)) {
      return { imported: prepared.imported, changed: false, revision }
    }

    await this.#restoration.discardRestorationGroups(trx, companyId)
    await this.#history.discardHistory(trx, companyId)
    for (const key of [...SCOPED_WRITE_ORDER].reverse()) {
      // A builder delete runs no fetch hooks, so soft-deleted rows go too.
      await companyRows(key, companyId, trx).delete()
    }
    const company = prepared.data.companies.at(0)
    if (!company) throw new Error('A prepared beta import always carries exactly one company.')
    const stored = await Company.findOrFail(companyId, { client: trx })
    await stored.merge(rowAttributes(Company, company)).save()
    for (const key of SCOPED_WRITE_ORDER) {
      await this.#insertThroughModel(trx, productModels[key], prepared.data[key])
    }
    await this.#audit.writeAudit(trx, {
      companyId,
      actorId,
      action: 'import',
      entity: 'company',
      entityId: companyId,
      fields: [],
    })
    const nextRevision = await this.#planningRevisions.advancePlanningRevision(trx, companyId)
    return { imported: prepared.imported, changed: true, revision: nextRevision }
  }
}
