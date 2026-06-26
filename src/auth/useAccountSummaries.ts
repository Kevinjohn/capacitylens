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
// trusted via an `as` cast). It runs OUTSIDE the tenant gate (mounted alongside the auth/permission
// providers in main.tsx) so the picker has the list before a tenant is chosen.

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
      try {
        const res = await fetch(`${API_BASE}/api/accounts`, { credentials: 'include' })
        if (!res.ok) return // leave the existing list; a blip shouldn't blank the picker (server 403 backstops)
        const body: unknown = await res.json()
        // UNTRUSTED external input: validate each entry's shape; drop off-spec rows rather than trusting
        // an `as` cast. A non-array body yields an empty list (the "no accounts" picker state).
        const list = Array.isArray(body)
          ? body.map(toSummary).filter((s): s is AccountSummary => s !== null)
          : []
        if (cancelled) return
        setAccountSummaries(list)
      } catch {
        // Fail-soft: a transport error (server down / offline / unreadable body) leaves the existing
        // list untouched. Not silent at the data layer — a real read/write surfaces its own banner.
      }
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
