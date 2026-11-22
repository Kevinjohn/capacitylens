import { useEffect } from 'react';
import { readApiData } from '@/api/readApiData';
import { useStore } from '@/store/useStore';
import type { CompanySummary } from '@/store/useStore';
import { isRole } from '@capacitylens/shared/account/types';
import { parseAccessGrant } from './accessGrant';
import { sessionRequests } from '@/account/sessionRequests';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import { hasDuplicateIdentity } from '@/lib/hasDuplicateIdentity';
import { m } from '@/i18n';
import { useAuth } from './authContext';

// The company directory is loaded before a company is selected because the active company set
// cannot enumerate other memberships.

// Validate directory entries before publication. Unknown roles and malformed grants remain
// selectable but fail closed without claiming an authoritative Viewer membership.
function parseCompanySummary(entry: unknown): CompanySummary | null {
  if (!isRecord(entry)) return null;
  if (typeof entry.id !== 'string' || entry.id.length === 0) return null;
  if (typeof entry.name !== 'string') return null;
  const grant = parseAccessGrant(entry);
  if (!isRole(entry.role) || !grant) {
    console.warn(
      'fetchCompanySummaries: /api/companies returned an unrecognized role or grant; marking it unavailable',
    );
    return { id: entry.id, name: entry.name, role: 'viewer', roleStatus: 'unavailable' };
  }
  return { id: entry.id, name: entry.name, role: entry.role, grant };
}

type CompanySummaryParseOutcome =
  | { kind: 'accepted'; valid: CompanySummary[]; complete: boolean; droppedCount: number }
  | { kind: 'rejected'; droppedCount: number };

function parseCompanySummaryList(body: unknown): CompanySummaryParseOutcome {
  if (!Array.isArray(body)) {
    console.warn(
      'fetchCompanySummaries: /api/companies returned a non-array body; reporting null (callers keep their existing list)',
    );
    return { kind: 'rejected', droppedCount: 0 };
  }
  const valid = body
    .map(parseCompanySummary)
    .filter((state): state is CompanySummary => state !== null);
  const droppedCount = body.length - valid.length;
  if (droppedCount > 0) {
    console.warn(`fetchCompanySummaries: dropped ${droppedCount} malformed /api/companies row(s)`);
  }
  if (body.length > 0 && valid.length === 0) return { kind: 'rejected', droppedCount };
  if (hasDuplicateIdentity(valid, (summary) => summary.id)) {
    console.warn(
      'fetchCompanySummaries: /api/companies returned duplicate company ids; reporting null',
    );
    return { kind: 'rejected', droppedCount };
  }
  return {
    kind: 'accepted',
    valid,
    complete: droppedCount === 0 && valid.every((summary) => summary.roleStatus !== 'unavailable'),
    droppedCount,
  };
}

type ReportCompanySummaryCompletenessOptions = {
  complete: boolean;
  onCompleteness: ((complete: boolean) => void) | undefined;
};

function reportCompanySummaryCompleteness(options: ReportCompanySummaryCompletenessOptions): void {
  const { complete, onCompleteness } = options;
  onCompleteness?.(complete);
}

function reportCompanySummaryParse(
  outcome: CompanySummaryParseOutcome,
  isCurrent: () => boolean,
): void {
  if (outcome.droppedCount > 0 && isCurrent()) {
    useStore.getState().setNotice(m.account_directory_incomplete(), 'warning');
  }
}

function reportCompanySummaryFailure(error: unknown): null {
  console.warn(
    'fetchCompanySummaries: /api/companies read failed; reporting null (callers keep their existing list)',
    error,
  );
  return null;
}

/**
 * Reads whether this person owns the installation's only company, which is how a setup conflict
 * caused by another tab's success looks.
 *
 * @throws An `Error` whose message is safe to show when the directory cannot be read.
 */
export async function readSoleCompanyOwnership(): Promise<boolean> {
  const response = await sessionRequests.listCompanies();
  if (!response.ok) {
    throw new Error('Could not verify company access. Refresh the page to try again.');
  }
  const companies: unknown = await readApiData(response);
  const company: unknown = Array.isArray(companies) && companies.length === 1 ? companies[0] : null;
  return isRecord(company) && company.role === 'owner' && typeof company.id === 'string';
}

/** Reads the validated company directory. Null means the read failed; only a genuine empty array means no companies. Mixed responses retain valid rows and log rejected entries. */
export async function fetchCompanySummaries(requestOptions?: {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  /** Reports whether the returned live list is complete enough to prove membership absence. */
  onCompleteness?: (complete: boolean) => void;
}): Promise<CompanySummary[] | null> {
  const isCurrent = requestOptions?.isCurrent ?? (() => true);
  try {
    const res = await sessionRequests.listCompanies(requestOptions?.signal);
    if (!res.ok) {
      if (res.status === 409 && isCurrent()) {
        useStore.getState().setCompanySummaries({ list: [], complete: false, ambiguous: true });
        useStore.getState().setNotice(m.account_directory_ambiguous(), 'warning');
      }
      return null;
    }
    const body: unknown = await readApiData(res);
    const parsed = parseCompanySummaryList(body);
    reportCompanySummaryParse(parsed, isCurrent);
    if (parsed.kind === 'rejected') return null;
    reportCompanySummaryCompleteness({
      complete: parsed.complete,
      onCompleteness: requestOptions?.onCompleteness,
    });
    return parsed.valid;
  } catch (e) {
    // A failed directory read preserves existing data; warn for diagnosis and return null rather than presenting a false empty directory.
    return reportCompanySummaryFailure(e);
  }
}

/**
 * Fetch and publish the company directory through the store's shared request sequence. Every
 * caller uses this boundary: a newer read or membership mutation makes an older response ineligible
 * to replace the company directory. The fetched list is also returned to reconcile active-company
 * selection; only publication to the shared store is sequenced.
 */
export async function refreshCompanySummaries(requestOptions?: {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  preserveActiveCompanyIfMissing?: boolean;
}): Promise<CompanySummary[] | null> {
  const callerIsCurrent = requestOptions?.isCurrent ?? (() => true);
  const requestId = useStore.getState().beginCompanySummariesRequest();
  const requestIsCurrent = () =>
    callerIsCurrent() && useStore.getState().companySummariesRequestId === requestId;
  const completeness = { value: false };
  const list = await fetchCompanySummaries({
    ...requestOptions,
    isCurrent: requestIsCurrent,
    onCompleteness: (value) => {
      completeness.value = value;
    },
  });
  if (list !== null && callerIsCurrent()) {
    const published = useStore
      .getState()
      .setCompanySummaries({ list, requestId, complete: completeness.value });
    const activeCompanyId = useStore.getState().activeCompanyId;
    if (
      published &&
      completeness.value &&
      requestOptions?.preserveActiveCompanyIfMissing !== true &&
      activeCompanyId !== null &&
      !list.some((company) => company.id === activeCompanyId)
    ) {
      // Internal membership repair: the authoritative directory proved this company is no longer
      // accessible, so close it synchronously before publishing the explanatory notice.
      useStore.getState().setActiveCompany(null);
      useStore.getState().setNotice(m.notice_company_access_removed(), 'warning');
    }
  }
  return list;
}

/** Keeps the company directory current in the store, its one home. Active-company reads belong to
 * PermissionProvider; failed reads preserve the previous list. */
export function useCompanySummaries(): void {
  // Re-read on the active company so a sign-in or membership change re-pulls the list.
  const activeCompanyId = useStore((state) => state.activeCompanyId);
  const masqueradeActive = useStore((state) => state.masquerade.kind !== 'inactive');
  const membershipRevision = useStore((state) => state.membershipRevision);
  const masqueradeGeneration = useStore((state) =>
    state.masquerade.kind === 'inactive' ? 0 : state.masquerade.generation,
  );
  const { user } = useAuth();
  const userId = user?.id ?? null;
  useEffect(() => {
    if (masqueradeActive || activeCompanyId !== null) return;
    const controller = new AbortController();
    void refreshCompanySummaries({
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted,
    });
    return () => controller.abort();
  }, [userId, activeCompanyId, masqueradeActive, membershipRevision, masqueradeGeneration]);
}
