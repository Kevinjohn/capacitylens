import { useEffect } from "react";
import { isServerConfigured } from "@/data/apiConfig";
import { useStore } from "@/store/useStore";
import type { AccountSummary } from "@/store/useStore";
import { isAccountRole } from "@capacitylens/shared/account/types";
import { accountClient } from "@/account/accountClient";
import { cacheAccountSummaries, readCachedAccountSummaries, setOfflineReadState } from "@/data/offlineCache";
import { isTransportFailure } from "@/data/requestTimeout";
import { hasDuplicateIdentity } from "@/lib/hasDuplicateIdentity";
import { m } from "@/i18n";

// The picker needs the server directory before a tenant is selected because the loaded tenant slice cannot enumerate other companies. Demo mode derives its directory from local accounts.

// Validate directory entries before publication. Unknown roles remain selectable but
// fail closed without claiming an authoritative Viewer membership.
function parseAccountSummary(entry: unknown): AccountSummary | null {
  if (typeof entry !== "object" || entry === null) return null;
  const summaryRecord = entry as { id?: unknown; name?: unknown; role?: unknown };
  if (typeof summaryRecord.id !== "string" || summaryRecord.id.length === 0) return null;
  if (typeof summaryRecord.name !== "string") return null;
  if (!isAccountRole(summaryRecord.role)) {
    console.warn("fetchAccountSummaries: /api/accounts returned an unrecognized role; marking it unavailable");
    return { id: summaryRecord.id, name: summaryRecord.name, role: "viewer", roleStatus: "unavailable" };
  }
  return { id: summaryRecord.id, name: summaryRecord.name, role: summaryRecord.role };
}

async function readCachedAccountSummaryFallback(acceptEffects: () => boolean): Promise<AccountSummary[] | null> {
  try {
    const cached = await readCachedAccountSummaries();
    if (!cached) return null;
    if (acceptEffects() && useStore.getState().activeAccountId === null) {
      // This snapshot proves only that the company directory is cached. While a company is open,
      // its slice may still be live, so the directory must not replace the slice loader's status.
      setOfflineReadState({ owner: "accounts", readOnly: true, lastUpdated: cached.savedAt });
    }
    return cached.value;
  } catch (error) {
    // A server outage and unavailable IndexedDB can happen together. Keep the total contract.
    console.warn("fetchAccountSummaries: the offline account list could not be read", error);
    return null;
  }
}

type AccountSummaryParseOutcome =
  | { kind: "accepted"; valid: AccountSummary[]; complete: boolean; droppedCount: number }
  | { kind: "rejected"; droppedCount: number };

function parseAccountSummaryList(body: unknown): AccountSummaryParseOutcome {
  if (!Array.isArray(body)) {
    console.warn(
      "fetchAccountSummaries: /api/accounts returned a non-array body; reporting null (callers keep their existing list)",
    );
    return { kind: "rejected", droppedCount: 0 };
  }
  const valid = body.map(parseAccountSummary).filter((state): state is AccountSummary => state !== null);
  const droppedCount = body.length - valid.length;
  if (droppedCount > 0) {
    console.warn(`fetchAccountSummaries: dropped ${droppedCount} malformed /api/accounts row(s)`);
  }
  if (body.length > 0 && valid.length === 0) return { kind: "rejected", droppedCount };
  if (hasDuplicateIdentity(valid, (summary) => summary.id)) {
    console.warn("fetchAccountSummaries: /api/accounts returned duplicate account identities; reporting null");
    return { kind: "rejected", droppedCount };
  }
  return {
    kind: "accepted",
    valid,
    complete: droppedCount === 0 && valid.every((summary) => summary.roleStatus !== "unavailable"),
    droppedCount,
  };
}

type ApplyLiveAccountSummaryEffectsOptions = {
  valid: AccountSummary[];
  complete: boolean;
  acceptEffects: () => boolean;
  onCompleteness: ((complete: boolean) => void) | undefined;
};

function applyLiveAccountSummaryEffects(options: ApplyLiveAccountSummaryEffectsOptions): void {
  const { valid, complete, acceptEffects, onCompleteness } = options;
  if (acceptEffects()) {
    if (useStore.getState().activeAccountId === null) setOfflineReadState({ owner: "accounts", readOnly: false });
    if (complete) {
      void cacheAccountSummaries(valid).catch((error) =>
        console.warn("fetchAccountSummaries: the offline account list could not be updated", error),
      );
    }
  }
  onCompleteness?.(complete);
}

function applyAccountSummaryParseEffects(outcome: AccountSummaryParseOutcome, acceptEffects: () => boolean): void {
  if (outcome.droppedCount > 0 && acceptEffects()) {
    useStore.getState().setNotice(m.picker_accounts_incomplete(), "warning");
  }
}

type ReadAccountSummaryFailureFallbackOptions = {
  error: unknown;
  allowCachedFallback: boolean;
  acceptEffects: () => boolean;
};
async function readAccountSummaryFailureFallback({
  error,
  allowCachedFallback,
  acceptEffects,
}: ReadAccountSummaryFailureFallbackOptions): Promise<AccountSummary[] | null> {
  console.warn(
    "fetchAccountSummaries: /api/accounts read failed; reporting null (callers keep their existing list)",
    error,
  );
  if (!isTransportFailure(error) || !allowCachedFallback) return null;
  return readCachedAccountSummaryFallback(acceptEffects);
}

/** Reads the validated company directory, using the encrypted cached directory only when permitted. Null means the read failed; only a genuine empty array means no companies. Mixed responses retain valid rows and log rejected entries. Callers requiring mutation reconciliation must disable cached fallback. */
export async function fetchAccountSummaries(requestOptions?: {
  signal?: AbortSignal;
  acceptEffects?: () => boolean;
  /** Mutation reconciliation and access transitions need a live server answer, not an offline
   * snapshot that cannot prove whether the operation committed. Ordinary picker reads may fall
   * back to the encrypted, user-bound read-only cache. */
  allowCachedFallback?: boolean;
  /** Reports whether the returned live list is complete enough to prove membership absence. */
  onCompleteness?: (complete: boolean) => void;
}): Promise<AccountSummary[] | null> {
  const acceptEffects = requestOptions?.acceptEffects ?? (() => true);
  const allowCachedFallback = requestOptions?.allowCachedFallback ?? true;
  try {
    const res = await accountClient.listWorkspaces(requestOptions?.signal);
    if (!res.ok) {
      return res.status >= 500 && allowCachedFallback ? readCachedAccountSummaryFallback(acceptEffects) : null;
    }
    const body: unknown = await res.json();
    const parsed = parseAccountSummaryList(body);
    applyAccountSummaryParseEffects(parsed, acceptEffects);
    if (parsed.kind === "rejected") return null;
    applyLiveAccountSummaryEffects({
      valid: parsed.valid,
      complete: parsed.complete,
      acceptEffects,
      onCompleteness: requestOptions?.onCompleteness,
    });
    return parsed.valid;
  } catch (e) {
    // A failed directory read preserves existing data; warn for diagnosis and return null rather than presenting a false empty directory.
    return readAccountSummaryFailureFallback({
      error: e,
      allowCachedFallback: allowCachedFallback,
      acceptEffects: acceptEffects,
    });
  }
}

/**
 * Fetch and publish the company directory through the store's shared request sequence. Every
 * server-mode caller uses this boundary: a newer read, or a direct create/delete mutation, makes an
 * older response ineligible to replace the picker list. The fetched list is still returned to the
 * caller for its local reconciliation flow; only the shared-store publication is sequenced.
 */
export async function refreshAccountSummaries(requestOptions?: {
  signal?: AbortSignal;
  acceptEffects?: () => boolean;
  allowCachedFallback?: boolean;
  preserveActiveAccountIfMissing?: boolean;
}): Promise<AccountSummary[] | null> {
  const callerAcceptsEffects = requestOptions?.acceptEffects ?? (() => true);
  const requestId = useStore.getState().beginAccountSummariesRequest();
  const requestIsCurrent = () => callerAcceptsEffects() && useStore.getState().accountSummariesRequestId === requestId;
  const completeness = { value: false };
  const list = await fetchAccountSummaries({
    ...requestOptions,
    acceptEffects: requestIsCurrent,
    onCompleteness: (value) => {
      completeness.value = value;
    },
  });
  if (list !== null && callerAcceptsEffects()) {
    const published = useStore
      .getState()
      .setAccountSummaries({ list: list, requestId: requestId, complete: completeness.value });
    const activeAccountId = useStore.getState().activeAccountId;
    if (
      published &&
      completeness.value &&
      requestOptions?.preserveActiveAccountIfMissing !== true &&
      activeAccountId !== null &&
      !list.some((account) => account.id === activeAccountId)
    ) {
      // Internal membership repair: the authoritative directory proved this account is no longer
      // accessible, so close it synchronously before publishing the explanatory notice.
      useStore.getState().setActiveAccount(null);
      useStore.getState().setNotice(m.notice_company_access_removed(), "warning");
    }
  }
  return list;
}

/** Keeps the picker directory current. Authenticated active-company reads belong to PermissionProvider; picker and auth-off reads belong here. Failed reads preserve the previous list, and demo mode derives local summaries. */
export function useAccountSummaries({
  refreshActiveAccount = true,
}: {
  /** Authenticated app bodies delegate active-account refreshes to PermissionProvider so the
   * directory and permission projection share one request. Auth-off has no active permission
   * lookup, so its shell keeps this enabled. Picker reads always remain owned by this hook. */
  refreshActiveAccount?: boolean;
} = {}): void {
  const serverMode = isServerConfigured();
  // Re-key the server request owner on the active account so a switch / sign-in re-pulls the list
  // (a freshly accepted invite or a just-created org then appears). Harmless in the demo build.
  const activeAccountId = useStore((state) => state.activeAccountId);
  const membershipRevision = useStore((state) => state.membershipRevision);
  // Demo accounts are the complete local directory; server account rows hold only the hydrated tenant and cannot drive the picker.
  const localAccounts = useStore((state) => state.data.accounts);

  useEffect(() => {
    if (!serverMode) return;
    if (activeAccountId !== null && !refreshActiveAccount) return;
    let cancelled = false;
    void (async () => {
      await refreshAccountSummaries({ acceptEffects: () => !cancelled });
    })();
    return () => {
      cancelled = true;
    };
  }, [serverMode, activeAccountId, membershipRevision, refreshActiveAccount]);

  useEffect(() => {
    if (serverMode) return;
    // Demo build: the picker's list is the store's accounts (tagged owner = full access, mirroring the
    // server's off wire shape so the pure `can` keeps local fully editable). Kept in lockstep on every
    // add/delete so the picker reflects changes without a fetch.
    useStore.getState().setAccountSummaries({
      list: localAccounts.map((allocation) => ({ id: allocation.id, name: allocation.name, role: "owner" as const })),
    });
  }, [serverMode, localAccounts]);
}
