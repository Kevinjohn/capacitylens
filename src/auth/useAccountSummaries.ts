import { useEffect } from 'react'
import { API_BASE, isServerConfigured } from '../data/apiConfig'
import { useStore } from '../store/useStore'
import type { AccountSummary } from '../store/useStore'
import type { Role } from '@capacitylens/shared/domain/access'

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

/** Narrowing guard for the UNTRUSTED `role` of a `/api/accounts` entry (the server is external input —
 *  validate the shape, don't `as`-cast it). An off-spec role degrades to 'owner' (full access) so a
 *  server bug never silently downgrades a real owner to read-only — the server 403 is the real gate. */
function isRole(v: unknown): v is Role {
  return v === 'owner' || v === 'admin' || v === 'editor' || v === 'viewer'
}

/** Coerce one UNTRUSTED `/api/accounts` array entry to an {@link AccountSummary}, or null if it's
 *  off-spec (not an object, missing id/name). A null entry is DROPPED — a malformed row must never
 *  crash the picker or smuggle a bogus account in. */
function toSummary(entry: unknown): AccountSummary | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as { id?: unknown; name?: unknown; role?: unknown }
  if (typeof e.id !== 'string' || e.id.length === 0) return null
  if (typeof e.name !== 'string') return null
  return { id: e.id, name: e.name, role: isRole(e.role) ? e.role : 'owner' }
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
 * @returns the validated list, or null on ANY failure (non-OK status, transport error, abort) —
 *          fail-soft, matching the hook's leave-the-existing-list-alone stance; the caller decides
 *          what a null means for its flow. A non-array body yields an empty list (a real "no
 *          accounts" answer).
 */
export async function fetchAccountSummaries(init?: { signal?: AbortSignal }): Promise<AccountSummary[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/accounts`, { credentials: 'include', signal: init?.signal })
    if (!res.ok) return null
    const body: unknown = await res.json()
    // UNTRUSTED external input: validate each entry's shape; drop off-spec rows rather than trusting
    // an `as` cast.
    return Array.isArray(body) ? body.map(toSummary).filter((s): s is AccountSummary => s !== null) : []
  } catch (e) {
    // Fail-soft by contract (see @returns): a transport error/abort is reported as null, never a
    // throw — the callers treat a failed list read as "keep what you have", not an error surface of
    // its own. Breadcrumb per DEFENSIVE-CODING.md §5: handled-but-logged, never totally silent.
    console.warn('fetchAccountSummaries: /api/accounts read failed; reporting null (callers keep their existing list)', e)
    return null
  }
}

/**
 * Keep {@link useStore}.accountSummaries — the AccountPicker's account list — in sync (P1.13).
 *
 * - SERVER mode: fetch `GET /api/accounts` once on mount (re-keyed on the active account so a sign-in
 *   or account switch re-pulls a fresh list). On any failure the existing list is LEFT AS-IS (a
 *   transient blip shouldn't blank the picker); a fully-off-spec body yields an empty list.
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
