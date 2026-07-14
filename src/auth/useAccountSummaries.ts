import { useEffect } from 'react'
import { API_BASE, isServerConfigured } from '../data/apiConfig'
import { useStore } from '../store/useStore'
import type { AccountSummary } from '../store/useStore'
import type { Role } from '@capacitylens/shared/domain/access'
import { requestSignal } from '../data/requestTimeout'
import {
  cacheAccountSummaries,
  readCachedAccountSummaries,
  setOfflineReadState,
} from '../data/offlineCache'

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

/** Narrowing guard for the UNTRUSTED `role` of a `/api/accounts` entry. */
function isRole(v: unknown): v is Role {
  return v === 'owner' || v === 'admin' || v === 'editor' || v === 'viewer'
}

/** Coerce one UNTRUSTED `/api/accounts` array entry to an {@link AccountSummary}, or null if it's
 *  off-spec (not an object, missing id/name). A null entry is DROPPED — a malformed row must never
 *  crash the picker or smuggle a bogus account in; an unrecognized role instead degrades to viewer
 *  (id/name still required). */
function toSummary(entry: unknown): AccountSummary | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as { id?: unknown; name?: unknown; role?: unknown }
  if (typeof e.id !== 'string' || e.id.length === 0) return null
  if (typeof e.name !== 'string') return null
  // An unrecognized role (a future/renamed server role, or a transient serialization blip) must NOT
  // drop an account the user is a member of from the picker — id/name are valid, only the role hint
  // is unknown. Degrade it to 'owner' so the account stays selectable; the actual edit gate is
  // PermissionProvider, which independently fail-closes an unknown ACTIVE-account role to viewer.
  const role: Role = isRole(e.role) ? e.role : 'viewer'
  return { id: e.id, name: e.name, role }
}

/**
 * Fetch `GET /api/accounts` and coerce it to a validated summaries list — the shared server read
 * behind {@link useAccountSummaries}, exported so routes that mount OUTSIDE AppShell (InviteAccept)
 * can pull a fresh list on demand: a just-joined account is in neither `data.accounts` nor
 * `accountSummaries` there, so `setActiveAccount` would reject it without this refetch.
 *
 * @param init optional `{ signal }` threaded to the fetch — lets a caller BOUND the read (e.g.
 *             InviteAccept's `AbortSignal.timeout(5000)` best-effort activation step); an abort
 *             lands in the catch below and reports as null like any other failure.
 * @returns the validated list, or null on ANY failure (non-OK status, transport error, abort,
 *          a 200 whose body is not an array, or a NONEMPTY array in which no row survives
 *          validation) — fail-soft, matching the hook's leave-the-existing-list-alone stance;
 *          the caller decides what a null means for its flow. `[]` is reserved for a genuine
 *          empty array (a real "no accounts" answer). A mixed body keeps its valid rows; every
 *          dropped row leaves a `console.warn` breadcrumb.
 */
export async function fetchAccountSummaries(init?: { signal?: AbortSignal }): Promise<AccountSummary[] | null> {
  const cachedFallback = async (): Promise<AccountSummary[] | null> => {
    const cached = await readCachedAccountSummaries()
    if (!cached) return null
    setOfflineReadState(true, cached.savedAt)
    return cached.value
  }
  try {
    const res = await fetch(`${API_BASE}/api/accounts`, { credentials: 'include', signal: requestSignal(init?.signal) })
    if (!res.ok) return res.status >= 500 ? cachedFallback() : null
    const body: unknown = await res.json()
    // UNTRUSTED external input: validate each entry's shape; drop off-spec rows rather than trusting
    // an `as` cast. A 200 whose body is NOT an array (a proxy HTML page, a server bug) is MALFORMED,
    // not "no accounts" — report null (keep-what-you-have, same as a transport error) rather than
    // an empty list that would blank the picker.
    if (!Array.isArray(body)) {
      console.warn('fetchAccountSummaries: /api/accounts returned a non-array body; reporting null (callers keep their existing list)', body)
      return null
    }
    const valid = body.map(toSummary).filter((s): s is AccountSummary => s !== null)
    if (valid.length < body.length) {
      // Partial corruption must not be silent (DEFENSIVE-CODING.md §5, handled-but-logged): every
      // dropped row is a server/proxy bug worth a breadcrumb even when the rest of the list is fine.
      console.warn(`fetchAccountSummaries: dropped ${body.length - valid.length} malformed /api/accounts row(s)`, body)
    }
    // A NONEMPTY array where EVERY row is off-spec is MALFORMED, not "no accounts" — report null
    // (keep-what-you-have, same as the non-array case above) rather than an [] that would blank
    // the picker over what is really a broken response. Only a genuinely empty array means [].
    if (body.length > 0 && valid.length === 0) return null
    setOfflineReadState(false)
    void cacheAccountSummaries(valid).catch((error) =>
      console.warn('fetchAccountSummaries: the offline account list could not be updated', error),
    )
    return valid
  } catch (e) {
    // Fail-soft by contract (see @returns): a transport error/abort is reported as null, never a
    // throw — the callers treat a failed list read as "keep what you have", not an error surface of
    // its own. Breadcrumb per DEFENSIVE-CODING.md §5: handled-but-logged, never totally silent.
    console.warn('fetchAccountSummaries: /api/accounts read failed; reporting null (callers keep their existing list)', e)
    try {
      return await cachedFallback()
    } catch (cacheError) {
      console.warn('fetchAccountSummaries: the offline account list could not be read', cacheError)
      return null
    }
  }
}

/**
 * Keep {@link useStore}.accountSummaries — the AccountPicker's account list — in sync (P1.13).
 *
 * - SERVER mode: fetch `GET /api/accounts` once on mount (re-keyed on the active account so a sign-in
 *   or account switch re-pulls a fresh list). On any failure — including a 200 whose body is not
 *   an array, or a nonempty array with zero valid rows — the existing list is LEFT AS-IS (a
 *   transient blip or a malformed body shouldn't blank the picker); only a genuine empty array
 *   empties it.
 * - DEMO build: derive the list from `data.accounts` on every change (no fetch).
 *
 * Renders nothing — it's a side-effect hook mounted high in the tree (alongside the auth providers).
 */
export function useAccountSummaries(): void {
  const serverMode = isServerConfigured()
  const setAccountSummaries = useStore((s) => s.setAccountSummaries)
  // Re-key the server fetch on the active account so a switch / sign-in re-pulls the list (a freshly
  // accepted invite or a just-created org then appears). Harmless in the demo build (that branch ignores it).
  const activeAccountId = useStore((s) => s.activeAccountId)
  // The demo build reads the accounts straight off the store; selecting the array keeps the derive effect
  // reactive to add/delete. (In server mode `data.accounts` holds only the active slice, so this is
  // NOT the picker source there — the fetch is.)
  const localAccounts = useStore((s) => s.data.accounts)

  useEffect(() => {
    if (!serverMode) return // demo build handled by the derive effect below
    let cancelled = false
    void (async () => {
      // A null list (non-OK / transport error) leaves the existing list untouched — a blip shouldn't
      // blank the picker (the server 403 backstops); a real read/write surfaces its own banner.
      const list = await fetchAccountSummaries()
      if (cancelled || list === null) return
      setAccountSummaries(list)
    })()
    return () => {
      cancelled = true
    }
  }, [serverMode, activeAccountId, setAccountSummaries])

  useEffect(() => {
    if (serverMode) return // server mode is driven by the fetch above, not the local derive
    // DEMO build: the picker's list IS the store's accounts (tagged owner = full access, mirroring the
    // server's OFF wire shape so the pure `can` keeps local fully editable). Kept in lockstep on every
    // add/delete so the picker reflects changes without a fetch.
    setAccountSummaries(localAccounts.map((a) => ({ id: a.id, name: a.name, role: 'owner' as const })))
  }, [serverMode, localAccounts, setAccountSummaries])
}
