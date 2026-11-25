import { inject } from '@adonisjs/core';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { AppData, ScopedEntityKey } from '@capacitylens/shared/types/entities';
import { normalizeCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays';
import { tables } from '#models_support/product_tables';
import type { PlanningAccessGrant } from '#services/planning/access_grant';
import {
  applyCreateDefaults,
  assertMayWriteRestrictedFields,
  beginEntityWrite,
  completeEntityWrite,
  toEntityWriteError,
  type EntityWriteOptions,
} from '#services/planning/entity_rules';
import {
  assertAllocationStartIsAvailable,
  assertAllocationStartsOnWorkingDay,
} from '#services/planning/entity_validation/domain';
import { RetainedRowService } from '#services/planning/retained_row_service';
import {
  RestorationService,
  type RestorationIdentity,
} from '#services/planning/restoration_service';
import { asRecord, type WrittenRow } from '#services/planning/writer';
import { PlanningWriterService } from '#services/planning/planning_writer_service';
import { RowValidationService } from '#services/planning/row_validation_service';
import ValidationRefusalException from '#exceptions/validation_refusal_exception';
import RecordChangedException from '#exceptions/record_changed_exception';

interface WriteEntityOptions<K extends ScopedEntityKey> {
  trx: TransactionClientContract;
  data: AppData;
  /** Receives one entry per row this write persists. */
  written: WrittenRow[];
  companyId: string;
  table: K;
  id: string;
  fields: Partial<AppData[K][number]>;
  accessGrant: PlanningAccessGrant;
  mode: 'create' | 'update';
  identity: RestorationIdentity;
  permissiveRepeatStart?: boolean;
  /** An update refuses the write when the stored row's `updatedAt` differs from this value. */
  expectedUpdatedAt?: string;
}

/** One past the company's highest discipline sort order, counting archived and deleted rows. */
function resolveNextDisciplineSortOrder(data: AppData, companyId: string): number {
  return data.disciplines
    .filter((row) => row.companyId === companyId)
    .reduce((next, row) => Math.max(next, row.sortOrder + 1), 0);
}

/** Validated planning row writes in the caller's transaction. */
@inject()
export class EntityWriteService {
  #retainedRows: RetainedRowService;
  #restoration: RestorationService;
  #writer: PlanningWriterService;
  #rowValidation: RowValidationService;

  constructor(
    retainedRows: RetainedRowService,
    restoration: RestorationService,
    writer: PlanningWriterService,
    rowValidation: RowValidationService
  ) {
    this.#retainedRows = retainedRows;
    this.#restoration = restoration;
    this.#writer = writer;
    this.#rowValidation = rowValidation;
  }

  /** Prepares one complete entity row for a typed write against the current transaction projection. */
  async prepareEntityWrite<K extends ScopedEntityKey>(
    table: K,
    row: Record<string, unknown>,
    stored: AppData[K][number] | undefined,
    state: AppData,
    accessGrant: PlanningAccessGrant,
    options: EntityWriteOptions
  ): Promise<AppData[K][number]> {
    const draft = beginEntityWrite(table, row, stored, accessGrant);
    let validated: AppData[K][number];
    try {
      validated = await this.#rowValidation.validateRow(table, draft.visible);
    } catch (error) {
      throw toEntityWriteError(error);
    }
    return completeEntityWrite(table, row, stored, state, accessGrant, options, draft, validated);
  }

  /**
   * Validates and writes one row in the caller's transaction, then mutates its unprojected company state.
   * Later compound entries validate against those changes. The caller owns rollback and atomic
   * revision, audit and commitment recording. Only later occurrences of a repeated create may use
   * permissiveRepeatStart; creates, duplicates and the first occurrence retain the working-day check.
   * Reusing a retained id requires the deleting actor's original native session; otherwise the
   * existing id-conflict refusal leaves the pending deletion intact. Identity is server-verified.
   */
  async writeEntity<K extends ScopedEntityKey>({
    trx,
    data,
    written,
    companyId,
    table,
    id,
    fields,
    accessGrant,
    mode,
    identity,
    permissiveRepeatStart,
    expectedUpdatedAt,
  }: WriteEntityOptions<K>) {
    const rows: readonly AppData[K][number][] = data[table];
    const existing = rows.find((row) => row.id === id);
    assertMayWriteRestrictedFields(table, asRecord(fields), accessGrant, mode);
    if (mode === 'create' && existing) {
      throw new ValidationRefusalException('The record already exists.');
    }
    if (
      mode === 'create' &&
      !this.#retainedRows.isRetainedTable(table) &&
      (await trx.from(tables[table]).select('id').where('id', id).first())
    ) {
      throw new ValidationRefusalException('The record already exists.');
    }
    if (mode === 'update' && !existing) {
      throw new ValidationRefusalException('The record was not found.');
    }
    if (
      mode === 'update' &&
      expectedUpdatedAt !== undefined &&
      existing?.updatedAt !== expectedUpdatedAt
    ) {
      throw new RecordChangedException();
    }
    const candidate: Record<string, unknown> = {
      ...(existing ?? {}),
      ...fields,
      id,
      companyId,
    };
    if (!existing) applyCreateDefaults(table, candidate);
    if (!existing && table === 'disciplines') {
      candidate.sortOrder = resolveNextDisciplineSortOrder(data, companyId);
    }
    const company = data.companies.find((row) => row.id === companyId);
    const companyWorkingDays = normalizeCompanyWorkingDays(
      company?.workingDays,
      company?.weekStartsOn === 0 ? 0 : 1
    );
    const clean = await this.prepareEntityWrite(table, candidate, existing, data, accessGrant, {
      companyWorkingDays,
    });
    if (table === 'allocations' && !permissiveRepeatStart) {
      assertAllocationStartsOnWorkingDay(
        asRecord(clean),
        existing && asRecord(existing),
        data,
        companyWorkingDays
      );
      assertAllocationStartIsAvailable(
        asRecord(clean),
        existing && asRecord(existing),
        data,
        companyId
      );
    }
    if (mode === 'create' && this.#retainedRows.isRetainedTable(table)) {
      await this.#restoration.reclaimRetainedId(trx, companyId, table, id, identity);
    }
    return this.#writer.writeRow({ trx, data, table, row: clean, existing, written });
  }
}
