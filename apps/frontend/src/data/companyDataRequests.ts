import type { BetaExportDocument } from '@capacitylens/shared/data/betaTransfer';
import { apiRouteUrl } from '@/api/queryClient';
import { apiFetch, API_BULK_TIMEOUT_MS } from '@/data/requestTimeout';
import { readApiError } from '@/lib/readApiError';
import { m } from '@/i18n';
import { isRecord } from '@capacitylens/shared/lib/isRecord';

/** The confirmed import of one transfer document into one company. */
export interface ApplyTransferInput {
  accountId: string;
  document: BetaExportDocument;
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
   * Reads the destination revision the server would replace with this document.
   *
   * @throws An `Error` whose message is safe to show when the server refuses the preview or answers
   *   off-spec.
   */
  async readTransferPreviewRevision(
    accountId: string,
    document: BetaExportDocument,
  ): Promise<number> {
    const response = await apiFetch('/api/transfer/preview', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, document }),
    });
    if (!response.ok) {
      throw new Error(
        (await readApiError(response)) ?? m.data_import_failed({ status: response.status }),
      );
    }
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== 'object' ||
      !('baseRevision' in result) ||
      !Number.isSafeInteger(result.baseRevision)
    ) {
      throw new Error(m.data_import_failed({ status: 0 }));
    }
    // This cast is sound because the value was just checked to be a safe integer.
    return result.baseRevision as number;
  },

  /** Sends a confirmed whole-company import. */
  applyTransfer({
    accountId,
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
        body: JSON.stringify({ accountId, document, baseRevision, confirmationId }),
      },
      API_BULK_TIMEOUT_MS,
    );
  },

  /** Sends the password-confirmed anonymisation of every person in one company. */
  anonymiseCompanyPeople(accountId: string, confirmationId: string): Promise<Response> {
    return apiFetch(
      `/api/accounts/${encodeURIComponent(accountId)}/anonymise`,
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
  anonymiseResource(accountId: string, resourceId: string): Promise<Response> {
    return apiFetch(
      `/api/accounts/${encodeURIComponent(accountId)}/resources/${encodeURIComponent(resourceId)}/anonymise`,
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
    return apiFetch(apiRouteUrl('api.example-data', { params: { accountId: companyId } }), {
      method: 'POST',
      credentials: 'include',
    });
  },
};
