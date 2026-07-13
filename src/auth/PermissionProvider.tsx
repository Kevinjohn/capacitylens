import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { API_BASE, isServerConfigured } from '../data/apiConfig'
import { useStore } from '../store/useStore'
import { useAuth } from './authContext'
import { PermissionContext } from './permissionContext'
import type { Role } from '@capacitylens/shared/domain/access'

// Client permission boundary (production plan P1.12). It resolves the caller's ROLE for the ACTIVE
// account and provides it to the pure-`can`-driven affordance hooks (useRole / useCanEdit) so a
// Viewer sees a read-only UI. It mounts INSIDE AppShell, around the app body subtree, AFTER the
// tenant/intro gates — so `activeAccountId` is already set when this runs.
//
// REGRESSION GUARD (load-bearing): in OFF mode OR the demo build (VITE_CAPACITYLENS_DEMO=1) this is a
// pure pass-through — `role: null`, ZERO fetches, ever (mirrors AuthProvider's demo-mode
// discipline). That is the shipped/default path and MUST stay byte-identical to today's app, which
// `role: null` → fully editable (see permissionContext.ts) guarantees.
//
// FAIL-CLOSED: in the auth-on + server path, pending/failed/missing role resolution is projected as
// viewer. This prevents an optimistic edit window after every account switch and prevents local UI
// divergence while the permission endpoint is unavailable. OFF/demo still use null (editable).

/** Narrowing guard for the untrusted `role` field of each `/api/accounts` entry. Off-spec data
 *  degrades to the provider's fail-closed viewer projection. */
function isRole(v: unknown): v is Role {
  return v === 'owner' || v === 'admin' || v === 'editor' || v === 'viewer'
}

/**
 * Resolve and provide the caller's role for the active account (P1.12).
 *
 * - OFF mode OR the demo build (no server): `role: null`, no fetch — the must-stay-editable path.
 * - auth-on + server + an active account: fetch `GET /api/accounts` ONCE per active account, find
 *   the entry whose `id === activeAccountId`, and set its role. Pending/failure/absence is viewer.
 *
 * The resolved role is ALSO pushed to the store (`setActiveRole`) so the store's defense-in-depth
 * mutation guard (P1.12) can no-op a viewer's optimistic local write — see useStore.assertCanWrite.
 */
export function PermissionProvider({ children }: { children: ReactNode }) {
  const { authMode } = useAuth()
  const activeAccountId = useStore((s) => s.activeAccountId)
  const setActiveRole = useStore((s) => s.setActiveRole)
  // The FETCHED role TAGGED with the account it was resolved for. Only ever set behind an `await` in
  // the effect's async IIFE (the MembersSection / AuthProvider idiom) — never synchronously in the
  // effect body — so there's no cascading-render setState-in-effect. Tagging with `accountId` is what
  // lets the value computation below DISCARD a prior tenant's role the instant the active account
  // changes (without a synchronous reset that the set-state-in-effect lint forbids): a stale entry
  // whose accountId !== activeAccountId reads as null (editable) until the new fetch lands.
  const [fetched, setFetched] = useState<{ accountId: string; role: Role | null } | null>(null)

  // Enabled ONLY in an auth-on, server-backed deploy. OFF / demo provides null and fetches nothing.
  const enabled = authMode !== 'off' && isServerConfigured()

  useEffect(() => {
    // OFF / demo / no active account: there is no membership role to enforce. Make NO request — the
    // shipped default path stays byte-identical to today. The provided role is null either way (the
    // value computation below short-circuits to null when not enabled), so no local reset is needed.
    if (!enabled || !activeAccountId) {
      setActiveRole(null) // keep the STORE guard in sync (a plain store write, not a React setState)
      return
    }
    let cancelled = false
    void (async () => {
      // Reset the store role BEFORE the await so a prior tenant's role can't leak across an account
      // switch while the new fetch is in flight (default-editable during the gap). The provider's own
      // value is already null for the new account until the fetch resolves (fetchedRole is keyed below).
      setActiveRole('viewer')
      try {
        const res = await fetch(`${API_BASE}/api/accounts`, { credentials: 'include' })
        if (!res.ok) return // fail-closed: keep the viewer projection installed above.
        // UNTRUSTED external input: validate the shape rather than trusting an `as` cast. We want the
        // entry for the ACTIVE account; anything off-spec (not an array, missing entry, bad role)
        // degrades to viewer. (The in-effect-async idiom
        // mirrors MembersSection: every setState is behind the await, never synchronous in the body.)
        const body: unknown = await res.json()
        const entry = Array.isArray(body)
          ? body.find((a): a is { id: string; role: unknown } =>
              typeof a === 'object' && a !== null && (a as { id?: unknown }).id === activeAccountId,
            )
          : undefined
        const resolved = entry && isRole(entry.role) ? entry.role : 'viewer'
        if (cancelled) return
        setFetched({ accountId: activeAccountId, role: resolved })
        setActiveRole(resolved)
      } catch {
        // Fail-closed: the store and context keep the viewer projection until a later successful
        // role lookup. No optimistic local mutation can diverge from the server during an outage.
      }
    })()
    return () => {
      cancelled = true
    }
    // activeAccountId in the deps re-keys the fetch per tenant; an account switch re-runs the effect
    // (resetting the store role above) and the stale `fetched` is discarded by the accountId tag check
    // in the value computation below until the new fetch lands.
  }, [enabled, activeAccountId, setActiveRole])

  // OFF / demo / no active account → null (editable). Otherwise use the fetched role ONLY when it was
  // resolved for the CURRENTLY active account (the accountId tag) — a prior tenant's role can't leak
  // across a switch. This computation is what lets the OFF/demo branch above avoid a synchronous
  // setState (the set-state-in-effect lint).
  const role =
    enabled && activeAccountId
      ? fetched?.accountId === activeAccountId
        ? (fetched.role ?? 'viewer')
        : 'viewer'
      : null

  // Memoise the context value on `role` so a re-render that doesn't change the role keeps the SAME
  // value reference — otherwise every consumer (the affordance hubs across the app) re-renders on any
  // parent re-render (e.g. AppShell re-rendering on a dirty-form keystroke), needless churn.
  const value = useMemo(() => ({ role }), [role])

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>
}
