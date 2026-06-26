import { useCallback } from 'react'
import { API_BASE, isServerConfigured } from '../data/apiConfig'
import { persistenceAdapter } from '../data/storageAdapter'
import { useStore, type LifecycleEntity } from '../store/useStore'
import { errorMessage } from '../lib/errorMessage'
import { m } from '@/i18n'

// The SINGLE dispatch seam for the Active → Archived → Soft-deleted → Purged data-lifecycle (P2.5b),
// shared by BOTH the management lists' Archive affordance (ResourceList/ClientList/ProjectList) and
// the Settings → "Archived & deleted" admin view (ArchivedSection). Extracted so the server/local
// branch + the post-mutation reload live in ONE place rather than being duplicated across four call
// sites.
//
// THE BRANCH (the decided architecture — see CLAUDE.md / P2.5b brief):
//   • SERVER mode (`isServerConfigured()` true): lifecycle mutations are SERVER-AUTHORITATIVE so the
//     interlocks (delete-needs-archived, purge tier + 30-day grace, resource-name PII obfuscation)
//     stay enforced server-side. The UI POSTs the dedicated P2.5a route (modeled on MembersSection's
//     hand-rolled fetches) and then RELOADS the active slice from the server — those routes write the
//     DB OUT-OF-BAND from the snapshot-diff sync, so without a reload the scheduler/lists wouldn't
//     reflect the change AND the adapter's diff snapshot would desync (next ordinary edit would emit a
//     spurious/garbage delta). On a non-OK response we surface `body.error` (a <30d purge → 409, a
//     non-admin purge / non-member → 403) and never crash.
//   • LOCAL/OFF mode (`isServerConfigured()` false): the UI calls the store action, which mutates the
//     local `data` blob immediately through the same mutate()/undo machinery (no fetch, no reload).
//     We wrap it in try/catch and surface the throw — these are the store's deliberate display-safe
//     integrity throws (builtin-Internal guard, illegal-transition backstop), exactly the ones the UI
//     pre-gates with the shared can* predicates but must still surface if they fire.

/** A lifecycle transition verb. Mirrors the four dedicated server routes + the four store actions. */
export type LifecycleVerb = 'archive' | 'unarchive' | 'delete' | 'purge'

/**
 * The dispatch surface returned by {@link useLifecycleActions}. Each method runs ONE lifecycle
 * transition for one entity row, branching server vs local internally. They are async because the
 * SERVER path awaits the route POST + the reload; in LOCAL mode they resolve synchronously after the
 * store mutation. The promise NEVER rejects — a failure is surfaced as a notice and the promise still
 * resolves, so a caller can `void` it without an unhandled rejection (the MembersSection idiom).
 */
export interface LifecycleActions {
  archive: (entity: LifecycleEntity, id: string) => Promise<void>
  unarchive: (entity: LifecycleEntity, id: string) => Promise<void>
  /** Soft-delete (archived → tombstone; a resource's name is scrubbed server- or store-side). */
  softDelete: (entity: LifecycleEntity, id: string) => Promise<void>
  /** Hard-purge a ≥30-day tombstone (admin-only / purge tier server-side). */
  purge: (entity: LifecycleEntity, id: string) => Promise<void>
}

/**
 * Re-hydrate the ACTIVE account's slice from the server after a server-mode lifecycle route call, so
 * the active views (scheduler / lists) reflect the out-of-band DB write AND the adapter's diff
 * snapshot is re-seeded (else the next ordinary edit would emit a spurious cross-snapshot delta).
 *
 * REUSE, not a hand-roll: `ServerSyncAdapter.loadAll(accountId)` is the SAME path the persist
 * switch-orchestrator / refresh-on-focus use (persist.ts `refreshActive`). It (a) re-fetches the
 * active slice via `GET /api/state?accountId=…` AND (b) re-seeds the adapter's private `lastSynced`
 * snapshot to EXACTLY that slice — atomically, in the one call. `replaceAll(slice)` then fires the
 * store data subscription, but because the snapshot now equals the slice the resulting diff is ZERO
 * ops — a harmless no-op save (the `loadingSlice` guard inside `refreshActive` only optimises that
 * no-op away; it is not required for correctness). LOCAL mode never calls this (its store actions
 * already mutate `data`).
 */
async function reloadFromServer(accountId: string): Promise<void> {
  const slice = await persistenceAdapter.loadAll(accountId)
  useStore.getState().replaceAll(slice)
}

/**
 * The lifecycle dispatch hook (P2.5b). Returns {@link LifecycleActions} whose methods branch
 * server-vs-local per the module header. An optional `onReloaded` callback fires after a SUCCESSFUL
 * server-mode mutation + reload — the admin section passes a `reloadKey` bump so its own
 * `?includeInactive=1` list re-fetches (the MembersSection idiom); the lists pass nothing (the active
 * view already re-renders off the reloaded store `data`).
 *
 * @param onReloaded - optional; called once after each successful server-mode mutation completes its
 *                     reload, so a caller maintaining its own inactive-row list can re-fetch it.
 */
export function useLifecycleActions(onReloaded?: () => void): LifecycleActions {
  const activeAccountId = useStore((s) => s.activeAccountId)
  const setNotice = useStore((s) => s.setNotice)
  const archiveEntity = useStore((s) => s.archiveEntity)
  const unarchiveEntity = useStore((s) => s.unarchiveEntity)
  const softDeleteEntity = useStore((s) => s.softDeleteEntity)
  const purgeEntity = useStore((s) => s.purgeEntity)

  // The single server-mode dispatch: POST the dedicated route with {accountId}, surface body.error on
  // a non-OK reply, else reload the active slice + ping onReloaded. Mirrors MembersSection's fetches.
  const dispatchServer = useCallback(
    async (verb: LifecycleVerb, entity: LifecycleEntity, id: string) => {
      if (!activeAccountId) return
      try {
        const res = await fetch(`${API_BASE}/api/${entity}/${id}/${verb}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: activeAccountId }),
        })
        if (!res.ok && res.status !== 204) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          // A <30d / non-admin purge is a 409/403 with a server message — show it, never crash.
          setNotice(body.error ?? m.settings_archived_err_action({ status: res.status }), 'error')
          return
        }
        // The dedicated routes write the DB out-of-band from the snapshot-diff sync, so a reload is
        // REQUIRED to refresh the active views + re-seed the adapter snapshot (see reloadFromServer).
        await reloadFromServer(activeAccountId)
        onReloaded?.()
      } catch (e) {
        // A transport error (server down / offline) — surface it; do not swallow.
        setNotice(m.settings_err_server({ error: errorMessage(e) }), 'error')
      }
    },
    [activeAccountId, setNotice, onReloaded],
  )

  // The single local-mode dispatch: call the store action; wrap so the store's deliberate display-safe
  // throws (builtin-Internal guard, illegal-transition backstop) surface as a notice rather than a
  // React error. purgeEntity surfaces its own <30d notice and no-ops (doesn't throw), handled inside.
  const dispatchLocal = useCallback(
    (verb: LifecycleVerb, entity: LifecycleEntity, id: string) => {
      try {
        switch (verb) {
          case 'archive':
            archiveEntity(entity, id)
            break
          case 'unarchive':
            unarchiveEntity(entity, id)
            break
          case 'delete':
            softDeleteEntity(entity, id)
            break
          case 'purge':
            purgeEntity(entity, id)
            break
        }
      } catch (e) {
        setNotice(errorMessage(e), 'error')
      }
    },
    [archiveEntity, unarchiveEntity, softDeleteEntity, purgeEntity, setNotice],
  )

  const run = useCallback(
    async (verb: LifecycleVerb, entity: LifecycleEntity, id: string) => {
      if (isServerConfigured()) {
        await dispatchServer(verb, entity, id)
      } else {
        dispatchLocal(verb, entity, id)
      }
    },
    [dispatchServer, dispatchLocal],
  )

  return {
    archive: useCallback((entity, id) => run('archive', entity, id), [run]),
    unarchive: useCallback((entity, id) => run('unarchive', entity, id), [run]),
    softDelete: useCallback((entity, id) => run('delete', entity, id), [run]),
    purge: useCallback((entity, id) => run('purge', entity, id), [run]),
  }
}
