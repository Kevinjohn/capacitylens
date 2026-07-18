import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { isServerConfigured } from '../data/apiConfig'
import { useStore } from '../store/useStore'
import { useAuth } from './authContext'
import { PermissionContext } from './permissionContext'
import type { Role } from '@capacitylens/shared/domain/access'
import { isAccountRole } from '@capacitylens/shared/account/types'
import { accountClient } from '../account/accountClient'
import { useOfflineState } from '../data/useOfflineState'

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
// viewer for affordance safety and separately labelled pending/unavailable for explanatory UI.
// This prevents an optimistic edit window after every account switch and prevents local UI
// divergence while the permission endpoint is unavailable. OFF/demo still use null (editable).

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
  const membershipRevision = useStore((s) => s.membershipRevision)
  const offline = useOfflineState()
  // The FETCHED role TAGGED with the account it was resolved for. Only ever set behind an `await` in
  // the effect's async IIFE (the MembersSection / AuthProvider idiom) — never synchronously in the
  // effect body — so there's no cascading-render setState-in-effect. Tagging with `accountId` is what
  // lets the value computation below DISCARD a prior tenant's role the instant the active account
  // changes (without a synchronous reset that the set-state-in-effect lint forbids): a stale entry
  // whose accountId/revision no longer matches reads as pending with a fail-closed Viewer projection
  // until the new fetch lands.
  const [fetched, setFetched] = useState<{
    accountId: string
    membershipRevision: number
    status: 'resolved' | 'unavailable'
    role?: Role
  } | null>(null)

  // Enabled ONLY in an auth-on, server-backed deploy. OFF / demo provides null and fetches nothing.
  const enabled = authMode !== 'off' && isServerConfigured()

  useEffect(() => {
    if (offline.readOnly) {
      setActiveRole('viewer')
      return
    }
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
      // switch while the new fetch is in flight. The provider's own value is already pending with a
      // Viewer projection for the new account until the keyed fetch resolves.
      setActiveRole('viewer')
      try {
        const res = await accountClient.listWorkspaces()
        if (!res.ok) {
          if (!cancelled) {
            setFetched({ accountId: activeAccountId, membershipRevision, status: 'unavailable' })
          }
          return
        }
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
        if (!entry || !isAccountRole(entry.role)) {
          if (!cancelled) {
            setFetched({ accountId: activeAccountId, membershipRevision, status: 'unavailable' })
          }
          return
        }
        if (cancelled) return
        setFetched({ accountId: activeAccountId, membershipRevision, status: 'resolved', role: entry.role })
        setActiveRole(entry.role)
      } catch (error) {
        // Fail-closed: the store and context keep the viewer projection until a later successful
        // role lookup. No optimistic local mutation can diverge from the server during an outage.
        console.warn('PermissionProvider: the active account role could not be resolved', error)
        if (!cancelled) {
          setFetched({ accountId: activeAccountId, membershipRevision, status: 'unavailable' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // activeAccountId in the deps re-keys the fetch per tenant; an account switch re-runs the effect
    // (resetting the store role above) and the stale `fetched` is discarded by the accountId tag check
    // in the value computation below until the new fetch lands.
  }, [enabled, activeAccountId, membershipRevision, offline.readOnly, setActiveRole])

  // OFF / demo / no active account → null (editable). Otherwise use the fetched role ONLY when it was
  // resolved for the CURRENTLY active account (the accountId tag) — a prior tenant's role can't leak
  // across a switch. This computation is what lets the OFF/demo branch above avoid a synchronous
  // setState (the set-state-in-effect lint).
  const currentFetched = fetched?.accountId === activeAccountId && fetched.membershipRevision === membershipRevision
    ? fetched
    : null
  const status: 'not-applicable' | 'pending' | 'resolved' | 'unavailable' = offline.readOnly
    ? 'resolved'
    : enabled && activeAccountId
      ? currentFetched?.status ?? 'pending'
      : 'not-applicable'
  const role =
    offline.readOnly
      ? 'viewer'
      : enabled && activeAccountId
      ? currentFetched?.status === 'resolved' && currentFetched.role
        ? currentFetched.role
        : 'viewer'
      : null

  // Memoise the context value on `role` so a re-render that doesn't change the role keeps the SAME
  // value reference — otherwise every consumer (the affordance hubs across the app) re-renders on any
  // parent re-render (e.g. AppShell re-rendering on a dirty-form keystroke), needless churn.
  const value = useMemo(() => ({ role, status }), [role, status])

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>
}
