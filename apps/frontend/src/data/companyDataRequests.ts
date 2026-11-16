import type { BetaExportDocument } from '@capacitylens/shared/data/betaTransfer';
import { apiFetch, API_BULK_TIMEOUT_MS } from '@/data/requestTimeout';
import { readApiError } from '@/lib/readApiError';
import { m } from '@/i18n';

/** The confirmed import of one transfer document into one company. */
export interface ApplyTransferInput {
  accountId: string;
  document: BetaExportDocument;
  baseRevision: number;
  confirmationId: string;
}

/**
 * Reads the destination revision the server would replace with this document.
 *
 * @throws An `Error` whose message is safe to show when the server refuses the preview or answers
 *   off-spec.
 */
export async function readTransferPreviewRevision(
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
}

/** Sends a confirmed whole-company import. */
export function applyTransfer({
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
}

/** Sends the password-confirmed anonymisation of every person in one company. */
export function anonymiseCompanyPeople(
  accountId: string,
  confirmationId: string,
): Promise<Response> {
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
}

/** Sends the anonymisation of one person resource. */
export function anonymiseResource(accountId: string, resourceId: string): Promise<Response> {
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
}
