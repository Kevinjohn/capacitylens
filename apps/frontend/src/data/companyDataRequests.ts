import { apiRouteUrl } from '@/api/queryClient';
import { apiFetch, API_BULK_TIMEOUT_MS } from '@/data/requestTimeout';
import { readApiError } from '@/lib/readApiError';
import { m } from '@/i18n';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import type { ScopedEntityKey } from '@capacitylens/shared/types/entities';

/** What the server reports about a transfer document it would import into one company. */
export interface TransferPreview {
  baseRevision: number;
  companyName: string;
  counts: Record<ScopedEntityKey, number>;
}

/** The confirmed import of one transfer document into one company. */
export interface ApplyTransferInput {
  companyId: string;
  document: unknown;
  baseRevision: number;
  confirmationId: string;
}

/**
 * The counts a committed import reports. `imported` is null for an off-spec success body; the
 * company was still replaced. `unchanged` is the server saying nothing changed; `changed` says
 * whether the page needs a fresh read.
 */
export interface ImportSummary {
  imported: number | null;
  skipped: number;
  unchanged: boolean;
  changed: boolean;
}

const parseCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Reads the summary of a committed import response, consuming its body. */
export async function readImportSummary(response: Response): Promise<ImportSummary> {
  // An unreadable body is an off-spec success, reported with the generic completion notice.
  const body: unknown = await response.json().catch(() => null);
  const imported = parseCount(isRecord(body) ? body.imported : undefined);
  const skipped = parseCount(isRecord(body) ? body.skipped : undefined) ?? 0;
  const unchanged = isRecord(body) && body.changed === false;
  const changed = imported === null || (!unchanged && imported > 0);
  return { imported, skipped, unchanged, changed };
}

/**
 * Requests that read or replace a whole company's data. The replacement senders return the raw
 * response for `runSuspendedReplacement`, whose typed outcome is what screens render.
 */
export const companyDataRequests = {
  /**
   * Asks the server to validate a transfer document and describe the import: the destination
   * revision it would replace, the document's company name and its rows per scoped table.
   *
   * @throws An `Error` whose message is safe to show when the server refuses the document or
   *   answers off-spec.
   */
  async readTransferPreview(companyId: string, document: unknown): Promise<TransferPreview> {
    const response = await apiFetch('/api/transfer/preview', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, document }),
    });
    if (!response.ok) {
      throw new Error(
        (await readApiError(response)) ?? m.data_import_failed({ status: response.status }),
      );
    }
    const result: unknown = await response.json();
    const counts = isRecord(result) && isRecord(result.counts) ? result.counts : null;
    if (
      !isRecord(result) ||
      !Number.isSafeInteger(result.baseRevision) ||
      typeof result.companyName !== 'string' ||
      !counts ||
      SCOPED_KEYS.some((key) => parseCount(counts[key]) === null)
    ) {
      throw new Error(m.data_import_failed({ status: 0 }));
    }
    // These casts are sound because each value was just checked.
    return {
      baseRevision: result.baseRevision as number,
      companyName: result.companyName,
      counts: Object.fromEntries(SCOPED_KEYS.map((key) => [key, counts[key]])) as Record<
        ScopedEntityKey,
        number
      >,
    };
  },

  /** Sends a confirmed whole-company import. */
  applyTransfer({
    companyId,
    document,
    baseRevision,
    confirmationId,
  }: ApplyTransferInput): Promise<Response> {
    return apiFetch(
      '/api/transfer/apply',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ companyId, document, baseRevision, confirmationId }),
      },
      API_BULK_TIMEOUT_MS,
    );
  },

  /** Sends the password-confirmed anonymisation of every person in one company. */
  anonymiseCompanyPeople(companyId: string, confirmationId: string): Promise<Response> {
    return apiFetch(
      `/api/companies/${encodeURIComponent(companyId)}/anonymise`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationId }),
      },
      API_BULK_TIMEOUT_MS,
    );
  },

  /** Sends the anonymisation of one person resource. */
  anonymiseResource(companyId: string, resourceId: string): Promise<Response> {
    return apiFetch(
      `/api/companies/${encodeURIComponent(companyId)}/resources/${encodeURIComponent(resourceId)}/anonymise`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      API_BULK_TIMEOUT_MS,
    );
  },

  /** Adds the small example company to an empty company. Not idempotent: a second call is refused. */
  addExampleData(companyId: string): Promise<Response> {
    return apiFetch(apiRouteUrl('api.example-data', { params: { companyId } }), {
      method: 'POST',
      credentials: 'include',
    });
  },
};
