import { Suspense, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { ImportExport } from './ImportExport'
import { AccountPicker } from './accounts/AccountPicker'
import { StorageRecovery } from './StorageRecovery'
import { ConnectionError } from './ConnectionError'
import { Toast } from './common/ui'

const LINKS: [string, string][] = [
  ['/', 'Schedule'],
  ['/resources', 'Resources'],
  ['/disciplines', 'Disciplines'],
  ['/clients', 'Clients'],
  ['/projects', 'Projects'],
  ['/tasks', 'Tasks'],
  ['/timeoff', 'Time off'],
  ['/settings', 'Settings'],
]

export function AppShell() {
  const hydrated = useStore((s) => s.hydrated)
  const persistError = useStore((s) => s.persistError)
  const loadError = useStore((s) => s.loadError)
  const connectionError = useStore((s) => s.connectionError)
  const notice = useStore((s) => s.notice)
  const setNotice = useStore((s) => s.setNotice)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const accounts = useStore((s) => s.data.accounts)
  const activeAccountId = useStore((s) => s.activeAccountId)
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null

  const dirtyForm = useStore((s) => s.dirtyForm)

  // Warn before a tab close / refresh would discard an open form's unsaved edits.
  useEffect(() => {
    if (!dirtyForm) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyForm])

  // Auto-dismiss info notices after a few seconds; ERROR notices persist until the
  // user dismisses them (an error toast that vanishes before it's read is useless).
  useEffect(() => {
    if (!notice || notice.tone === 'error') return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice, setNotice])

  // Global undo/redo: ⌘Z / ⌘⇧Z (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Remote-load gate: the server couldn't be reached, so block with a retry screen
  // rather than the localStorage reset UI (which can't recover a server-backed app).
  if (connectionError) return <ConnectionError />

  // Corrupt-data gate: if stored data couldn't be read, block the app with a
  // recovery screen rather than letting the user edit an empty dataset that would
  // overwrite the unreadable-but-recoverable bytes.
  if (loadError) return <StorageRecovery />

  // Tenant gate: once hydrated, no chosen account means show the picker (it's
  // never persisted, so this is every load). Kept after the hydration check so
  // the "Loading…" state still renders the shell.
  if (hydrated && !activeAccount) return <AccountPicker />

  const loader = (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden />
      Loading…
    </div>
  )

  return (
    <div className="flex h-full">
      <nav className="w-48 shrink-0 border-r border-line bg-surface p-3">
        <div className="mb-4 px-2 text-xl font-bold text-brand">Floaty</div>
        {activeAccount && (
          <div className="mb-3 border-b border-line px-2 pb-3">
            <div className="truncate text-sm font-semibold text-ink" title={activeAccount.name}>
              {activeAccount.name}
            </div>
            <button
              type="button"
              onClick={() => setActiveAccount(null)}
              className="mt-0.5 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Switch company
            </button>
          </div>
        )}
        <ul className="space-y-1">
          {LINKS.map(([to, label]) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `block rounded-md px-2 py-1.5 text-sm ${
                    isActive ? 'bg-brand-soft font-semibold text-ink' : 'text-ink hover:bg-canvas'
                  }`
                }
              >
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
        <ImportExport />
      </nav>
      <main className="flex-1 overflow-auto">
        {persistError && (
          <div role="alert" className="bg-danger px-4 py-2 text-sm font-medium text-white">
            Changes aren’t being saved — your browser storage is full or unavailable.
          </div>
        )}
        {hydrated ? (
          <Suspense fallback={loader}>
            <Outlet />
          </Suspense>
        ) : (
          loader
        )}
      </main>
      {notice && <Toast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />}
    </div>
  )
}
