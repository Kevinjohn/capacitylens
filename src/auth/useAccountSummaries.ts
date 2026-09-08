import { useEffect } from "react";
import { isServerConfigured } from "../data/apiConfig";
import { useStore } from "../store/useStore";
import type { AccountSummary } from "../store/useStore";
import { isAccountRole } from "@capacitylens/shared/account/types";
import { accountClient } from "../account/accountClient";
import { cacheAccountSummaries, readCachedAccountSummaries, setOfflineReadState } from "../data/offlineCache";
import { isTransportFailure } from "../data/requestTimeout";
import { hasDuplicateIdentity } from "../lib/hasDuplicateIdentity";
import { m } from "@/i18n";

// The AccountPicker's data source (production plan P1.13). It populates `store.accountSummaries` — the
// list of accounts the login may OPEN — from the right source for the deploy:
//
//   - SERVER mode (the default, OFF *or* auth-on): fetch `GET /api/accounts`. Auth-on
//     returns ONLY the caller's memberships; OFF returns every account tagged role:'owner'. Either way
//     the picker lists exactly what the server says this login may open — and the no-arg whole-state
//     read is closed in auth-on, so this is the ONLY way the client learns the account list.
//   - DEMO build (VITE_CAPACITYLENS_DEMO=1, no server): derive the summaries from `data.accounts` (NO
//     fetch) — the picker shows the local companies the store holds.
//
// MIRRORS PermissionProvider's idiom exactly: an in-effect async IIFE with a cancellation flag, every
// setState behind the await, an UNTRUSTED-shape guard on the server body (a bad entry is dropped, not
// trusted via an `as` cast). It runs OUTSIDE the tenant gate (called at the top of AppShell, before
// the tenant gate) so the picker has the list before a tenant is chosen.

/** Coerce one UNTRUSTED `/api/accounts` array entry to an {@link AccountSummary}, or null if it's
 *  off-spec (not an object, missing id/name). A null entry is DROPPED — a malformed row must never
 *  crash the picker or smuggle a bogus account in. A valid account with an unrecognized role stays
 *  selectable under a fail-closed Viewer projection, but is explicitly tagged unavailable so the
 *  picker never presents Viewer as an authoritative membership role. */
function parseAccountSummary(entry: unknown): AccountSummary | null {
  if (typeof entry !== "object" || entry === null) return null;
  const summaryRecord = entry as { id?: unknown; name?: unknown; role?: unknown };
  if (typeof summaryRecord.id !== "string" || summaryRecord.id.length === 0) return null;
  if (typeof summaryRecord.name !== "string") return null;
  if (!isAccountRole(summaryRecord.role)) {
    console.warn("fetchAccountSummaries: /api/accounts returned an unrecognized role; marking it unavailable", entry);
    return { id: summaryRecord.id, name: summaryRecord.name, role: "viewer", roleStatus: "unavailable" };
  }
  return { id: summaryRecord.id, name: summaryRecord.name, role: summaryRecord.role };
}

async function readCachedAccountSummaryFallback(acceptEffects: () => boolean): Promise<AccountSummary[] | null> {
  try {
    const cached = await readCachedAccountSummaries();
    if (!cached) return null;
    if (acceptEffects() && useStore.getState().activeAccountId === null) {
      // This snapshot proves only that the company DIRECTORY is cached. While a company is open,
      // its slice may still be live, so the directory must not replace the slice loader's status.
      setOfflineReadState("accounts", true, cached.savedAt);
    }
    return cached.value;
  } catch (error) {
    // A server outage and unavailable IndexedDB can happen together. Keep the total contract.
    console.warn("fetchAccountSummaries: the offline account list could not be read", error);
    return null;
  }
}

type ParsedAccountSummaryList = { valid: AccountSummary[]; complete: boolean };

function parseAccountSummaryList(body: unknown, acceptEffects: () => boolean): ParsedAccountSummaryList | null {
  if (!Array.isArray(body)) {
    console.warn(
      "fetchAccountSummaries: /api/accounts returned a non-array body; reporting null (callers keep their existing list)",
      body,
    );
    return null;
  }
  const valid = body.map(parseAccountSummary).filter((state): state is AccountSummary => state !== null);
  const droppedCount = body.length - valid.length;
  if (droppedCount > 0) {
    console.warn(`fetchAccountSummaries: dropped ${droppedCount} malformed /api/accounts row(s)`, body);
    if (acceptEffects()) useStore.getState().setNotice(m.picker_accounts_incomplete(), "warning");
  }
  if (body.length > 0 && valid.length === 0) return null;
  if (hasDuplicateIdentity(valid, (summary) => summary.id)) {
    console.warn("fetchAccountSummaries: /api/accounts returned duplicate account identities; reporting null");
    return null;
  }
  return { valid, complete: droppedCount === 0 && valid.every((summary) => summary.roleStatus !== "unavailable") };
}

type AcceptLiveAccountSummaryListOptions = {
  valid: AccountSummary[];
  complete: boolean;
  acceptEffects: () => boolean;
  onCompleteness: ((complete: boolean) => void) | undefined;
};

function acceptLiveAccountSummaryList(options: AcceptLiveAccountSummaryListOptions): void {
  const { valid, complete, acceptEffects, onCompleteness } = options;
  if (acceptEffects()) {
    if (useStore.getState().activeAccountId === null) setOfflineReadState("accounts", false);
    if (complete) {
      void cacheAccountSummaries(valid).catch((error) =>
        console.warn("fetchAccountSummaries: the offline account list could not be updated", error),
      );
    }
  }
  onCompleteness?.(complete);
}

async function handleAccountSummaryReadFailure(
  error: unknown,
  allowCachedFallback: boolean,
  acceptEffects: () => boolean,
): Promise<AccountSummary[] | null> {
  console.warn(
    "fetchAccountSummaries: /api/accounts read failed; reporting null (callers keep their existing list)",
    error,
  );
  if (!isTransportFailure(error) || !allowCachedFallback) return null;
  return readCachedAccountSummaryFallback(acceptEffects);
}

/**
 * Fetch `GET /api/accounts` and coerce it to a validated summaries list — the shared server read
 * behind {@link useAccountSummaries}, exported so routes that mount OUTSIDE AppShell (InviteAccept)
 * can pull a fresh list on demand: a just-joined account is in neither `data.accounts` nor
 * `accountSummaries` there, so `setActiveAccount` would reject it without this refetch.
 *
 * @param requestOptions optional `{ signal }` threaded to the fetch — lets a caller BOUND the read (e.g.
 *             InviteAccept's `AbortSignal.timeout(5000)` best-effort activation step); an abort
 *             lands in the catch below and reports as null like any other failure.
 * @returns the validated list, or null on ANY failure (non-OK status, transport error, abort,
 *          a 200 whose body is not an array, or a NONEMPTY array in which no row survives
 *          validation) — fail-soft, matching the hook's leave-the-existing-list-alone stance;
 *          the caller decides what a null means for its flow. `[]` is reserved for a genuine
 *          empty array (a real "no accounts" answer). A mixed body keeps its valid rows; every
 *          dropped row leaves a `console.warn` breadcrumb.
 */
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
    const parsed = parseAccountSummaryList(body, acceptEffects);
    if (parsed === null) return null;
    acceptLiveAccountSummaryList({
      valid: parsed.valid,
      complete: parsed.complete,
      acceptEffects,
      onCompleteness: requestOptions?.onCompleteness,
    });
    return parsed.valid;
  } catch (e) {
    // Fail-soft by contract (see @returns): a transport error/abort is reported as null, never a
    // throw — the callers treat a failed list read as "keep what you have", not an error surface of
    // its own. Breadcrumb per DEFENSIVE-CODING.md §5: handled-but-logged, never totally silent.
    return handleAccountSummaryReadFailure(e, allowCachedFallback, acceptEffects);
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
    const published = useStore.getState().setAccountSummaries(list, requestId, completeness.value);
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

/**
 * Keep {@link useStore}.accountSummaries — the AccountPicker's account list — in sync (P1.13).
 *
 * - SERVER mode: own picker reads and auth-off active-account reads. Authenticated active-account
 *   generations are yielded to PermissionProvider, which uses the same validated refresh and
 *   publishes its result here. On any failure — including a 200 whose body is not an array, or a
 *   nonempty array with zero valid rows — the existing list is LEFT AS-IS (a transient blip or a
 *   malformed body shouldn't blank the picker); only a genuine empty array empties it.
 * - DEMO build: derive the list from `data.accounts` on every change (no fetch).
 *
 * Renders nothing — it's a side-effect hook mounted high in the tree (alongside the auth providers).
 */
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
  // The demo build reads the accounts straight off the store; selecting the array keeps the derive effect
  // reactive to add/delete. (In server mode `data.accounts` holds only the active slice, so this is
  // NOT the picker source there — the fetch is.)
  const localAccounts = useStore((state) => state.data.accounts);

  useEffect(() => {
    if (!serverMode) return; // demo build handled by the derive effect below
    if (activeAccountId !== null && !refreshActiveAccount) return;
    let cancelled = false;
    void (async () => {
      // A null list (non-OK / transport error) leaves the existing list untouched — a blip shouldn't
      // blank the picker (the server 403 backstops); a real read/write surfaces its own banner.
      await refreshAccountSummaries({ acceptEffects: () => !cancelled });
    })();
    return () => {
      cancelled = true;
    };
  }, [serverMode, activeAccountId, membershipRevision, refreshActiveAccount]);

  useEffect(() => {
    if (serverMode) return; // server mode is driven by the fetch above, not the local derive
    // DEMO build: the picker's list IS the store's accounts (tagged owner = full access, mirroring the
    // server's OFF wire shape so the pure `can` keeps local fully editable). Kept in lockstep on every
    // add/delete so the picker reflects changes without a fetch.
    useStore
      .getState()
      .setAccountSummaries(
        localAccounts.map((allocation) => ({ id: allocation.id, name: allocation.name, role: "owner" as const })),
      );
  }, [serverMode, localAccounts]);
}
