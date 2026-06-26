import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { API_BASE, isServerConfigured } from '../../data/apiConfig'
import { useStore, type LifecycleEntity } from '../../store/useStore'
import { useInactiveScopedData } from '../../store/useScopedData'
import { useLifecycleActions } from '../../hooks/useLifecycleActions'
import { useRole } from '../../auth/permissionContext'
import { errorMessage } from '../../lib/errorMessage'
import { Button, ConfirmDialog } from '../common/ui'
import { m } from '@/i18n'
import { can } from '@capacitylens/shared/domain/access'
import { canPurge, lifecycleStatus, PURGE_MIN_AGE_DAYS } from '@capacitylens/shared/domain/lifecycle'
import { todayISO } from '@capacitylens/shared/lib/dateMath'
import type { AppData, Client, Project, Resource } from '@capacitylens/shared/types/entities'

// Settings → "Archived & deleted" — the client-admin view of the data-lifecycle (P2.5b), the
// COUNTERPART to the normal active-only views. It lists the resources/clients/projects the scheduler
// and management lists HIDE (archived + soft-deleted tombstones) and drives the lifecycle transitions
// through `useLifecycleActions` (which branches server/local — see that hook). Modeled on
// MembersSection: in SERVER mode it self-gates on a 403 from the inactive read and re-fetches on a
// `reloadKey` bump; in LOCAL mode it always renders (everyone is owner locally) and reads the
// inactive rows straight from the store via `useInactiveScopedData`.

// One inactive row, normalised across the three lifecycle tables so the two groups (archived /
// tombstone) render uniformly. `entity` is the table key the dispatch + the type tag need; `name` is
// the already-display-ready label (a deleted resource's name is the server/store-scrubbed
// "Removed person #…", which we render verbatim).
interface Row {
  entity: LifecycleEntity
  id: string
  name: string
  /** The raw lifecycle-bearing record — fed to `canPurge` to gate the permanent-delete button. */
  raw: Resource | Client | Project
}

// A row's display name: prefer the stored `name` (a resource tombstone's is the obfuscated token),
// fall back to a resource's `role` for a nameless placeholder/external. Clients/projects always carry
// a name. Kept local (not resourceDisplayName) so a placeholder tombstone shows its scrubbed name/role
// rather than the generic "Placeholder" label the scheduler uses.
function rowName(entity: LifecycleEntity, e: Resource | Client | Project): string {
  if (entity === 'resources') {
    const r = e as Resource
    return r.name ?? r.role
  }
  return (e as Client | Project).name
}

// Collect every NON-active row across the three tables into a flat list, preserving entity identity.
function collectInactive(data: AppData): Row[] {
  const out: Row[] = []
  const push = (entity: LifecycleEntity, list: (Resource | Client | Project)[]) => {
    for (const e of list) {
      if (lifecycleStatus(e) !== 'active') out.push({ entity, id: e.id, name: rowName(entity, e), raw: e })
    }
  }
  push('resources', data.resources)
  push('clients', data.clients)
  push('projects', data.projects)
  return out
}

const TYPE_LABEL: Record<LifecycleEntity, () => string> = {
  resources: () => m.settings_archived_type_resources(),
  clients: () => m.settings_archived_type_clients(),
  projects: () => m.settings_archived_type_projects(),
}

/**
 * The Settings → "Archived & deleted" admin view (P2.5b). Partitions the inactive rows into Archived
 * (restore / delete) and Deleted-tombstone (permanently delete) groups and drives each transition
 * through the shared {@link useLifecycleActions} dispatch. SERVER mode fetches the inactive slice with
 * `?includeInactive=1` and self-hides on a 403 (admin-tier gate); LOCAL mode reads it from the store
 * and always renders. The permanent-delete button is gated client-side by `canPurge` (disabled with a
 * locked hint until the 30-day grace elapses) AND by the purge role tier; the server is the backstop.
 */
export function ArchivedSection() {
  const server = isServerConfigured()
  const activeAccountId = useStore((s) => s.activeAccountId)
  const setNotice = useStore((s) => s.setNotice)
  const role = useRole()
  // Stable, render-unique base for the per-row "30-day locked" hint ids, so each disabled purge
  // button can point its aria-describedby at its OWN hint (suffixed with entity-id below). Without
  // this a screen reader announces only "Permanently delete {name}" with no reason it's disabled.
  const hintBaseId = useId()

  // LOCAL-mode source: the raw scoped slice (active + archived + deleted), filtered below.
  const localData = useInactiveScopedData()

  // SERVER-mode source: an ?includeInactive=1 fetch, with the MembersSection 403-self-hide gate.
  const [serverRows, setServerRows] = useState<Row[] | null>(null)
  const [gate, setGate] = useState<'loading' | 'shown' | 'hidden'>(server ? 'loading' : 'shown')
  // Bumped after every successful mutation to re-run the inactive fetch (server) — the MembersSection
  // reloadKey idiom. (Local mode re-renders off the store directly, so the bump is a harmless no-op.)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // Confirm-dialog targets: a soft-delete (archived → tombstone) and a permanent purge each need
  // confirmation, so park the pending row until the user confirms (null = no dialog open).
  const [confirmingDelete, setConfirmingDelete] = useState<Row | null>(null)
  const [confirmingPurge, setConfirmingPurge] = useState<Row | null>(null)

  const actions = useLifecycleActions(reload)

  useEffect(() => {
    if (!server || !activeAccountId) return
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/state?accountId=${encodeURIComponent(activeAccountId)}&includeInactive=1`,
          { credentials: 'include' },
        )
        if (res.status === 403) {
          setGate('hidden') // a non-admin asked for the inactive slice — hide the whole section.
          return
        }
        if (!res.ok) {
          setGate('shown')
          setNotice(m.settings_archived_err_load({ status: res.status }), 'error')
          return
        }
        const body = (await res.json()) as AppData
        setServerRows(collectInactive(body))
        setGate('shown')
      } catch (e) {
        setGate('shown')
        setNotice(m.settings_err_server({ error: errorMessage(e) }), 'error')
      }
    })()
  }, [server, activeAccountId, reloadKey, setNotice])

  // The rows to render: server fetch in server mode, the store slice in local mode.
  const rows = useMemo(
    () => (server ? (serverRows ?? []) : collectInactive(localData)),
    [server, serverRows, localData],
  )
  const archived = rows.filter((r) => lifecycleStatus(r.raw) === 'archived')
  const deleted = rows.filter((r) => lifecycleStatus(r.raw) === 'deleted')

  // Purge is the admin tier: in OFF/local `role` is null (full access); on an auth-on server only
  // admin+ may purge. The server 403 is the backstop; this hides the button for a non-purger.
  const mayPurge = role === null || can(role, 'purge')

  if (server && gate !== 'shown') return null // OFF-of-server: 403 self-gated, or still loading.

  return (
    <section className="rounded border border-line bg-surface p-4" data-testid="archived-section">
      <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_archived_heading()}</h2>
      <p className="mb-3 text-xs text-muted">{m.settings_archived_intro()}</p>

      {rows.length === 0 && <p className="py-2 text-sm text-muted">{m.settings_archived_empty()}</p>}

      {/* Archived group — restore (→ active) or delete (→ tombstone). */}
      {archived.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-1 text-xs font-semibold text-ink">{m.settings_archived_group_archived()}</h3>
          <div className="divide-y divide-line">
            {archived.map((r) => (
              <div
                key={`${r.entity}-${r.id}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                data-testid="archived-row"
              >
                <span className="min-w-0">
                  <span className="text-sm text-ink">{r.name}</span>
                  <span className="ml-2 text-xs text-muted">· {TYPE_LABEL[r.entity]()}</span>
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    testId="archived-restore"
                    ariaLabel={m.settings_archived_restore_aria({ name: r.name })}
                    onClick={() => void actions.unarchive(r.entity, r.id)}
                  >
                    {m.settings_archived_restore()}
                  </Button>
                  <Button
                    variant="danger"
                    testId="archived-delete"
                    ariaLabel={m.settings_archived_delete_aria({ name: r.name })}
                    onClick={() => setConfirmingDelete(r)}
                  >
                    {m.settings_archived_delete()}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deleted (tombstone) group — permanent purge, gated by canPurge + the purge role tier. */}
      {deleted.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-ink">{m.settings_archived_group_deleted()}</h3>
          <div className="divide-y divide-line">
            {deleted.map((r) => {
              const purgeable = canPurge(r.raw, todayISO())
              // The "locked" hint only renders (and is only referenced) while the purge button is
              // disabled, so a screen reader hears WHY it can't act yet, not just the button name.
              const hintId = `${hintBaseId}-${r.entity}-${r.id}`
              return (
                <div
                  key={`${r.entity}-${r.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  data-testid="deleted-row"
                >
                  <span className="min-w-0">
                    <span className="text-sm text-ink">{r.name}</span>
                    <span className="ml-2 text-xs text-muted">· {TYPE_LABEL[r.entity]()}</span>
                  </span>
                  {mayPurge && (
                    <div className="flex items-center gap-2">
                      {!purgeable && (
                        <span id={hintId} className="text-xs text-muted">
                          {m.settings_archived_purge_locked_hint({ days: PURGE_MIN_AGE_DAYS })}
                        </span>
                      )}
                      <Button
                        variant="danger"
                        testId="archived-purge"
                        disabled={!purgeable}
                        ariaLabel={m.settings_archived_purge_aria({ name: r.name })}
                        describedById={!purgeable ? hintId : undefined}
                        onClick={() => setConfirmingPurge(r)}
                      >
                        {m.settings_archived_purge()}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={m.settings_archived_delete_title()}
          message={m.settings_archived_delete_message({ name: confirmingDelete.name })}
          confirmLabel={m.settings_archived_delete()}
          onConfirm={() => {
            void actions.softDelete(confirmingDelete.entity, confirmingDelete.id)
            setConfirmingDelete(null)
          }}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}

      {confirmingPurge && (
        <ConfirmDialog
          title={m.settings_archived_purge_title()}
          message={m.settings_archived_purge_message({ name: confirmingPurge.name })}
          confirmLabel={m.settings_archived_purge_confirm()}
          onConfirm={() => {
            void actions.purge(confirmingPurge.entity, confirmingPurge.id)
            setConfirmingPurge(null)
          }}
          onCancel={() => setConfirmingPurge(null)}
        />
      )}
    </section>
  )
}
