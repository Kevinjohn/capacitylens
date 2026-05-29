import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { ImportExport } from './ImportExport'
import { Toast } from './common/ui'

const LINKS: [string, string][] = [
  ['/', 'Schedule'],
  ['/resources', 'Resources'],
  ['/disciplines', 'Disciplines'],
  ['/clients', 'Clients'],
  ['/projects', 'Projects'],
  ['/tasks', 'Tasks'],
  ['/timeoff', 'Time off'],
]

export function AppShell() {
  const hydrated = useStore((s) => s.hydrated)
  const persistError = useStore((s) => s.persistError)
  const notice = useStore((s) => s.notice)
  const setNotice = useStore((s) => s.setNotice)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)

  // Auto-dismiss transient notices after a few seconds.
  useEffect(() => {
    if (!notice) return
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

  return (
    <div className="flex h-full">
      <nav className="w-48 shrink-0 border-r border-line bg-surface p-3">
        <div className="mb-4 px-2 text-xl font-bold text-brand">Floaty</div>
        <ul className="space-y-1">
          {LINKS.map(([to, label]) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `block rounded px-2 py-1.5 text-sm ${
                    isActive ? 'bg-brand-soft font-semibold text-ink' : 'text-ink hover:bg-base'
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
        {hydrated ? <Outlet /> : <div className="p-6 text-muted">Loading…</div>}
      </main>
      {notice && <Toast message={notice} onDismiss={() => setNotice(null)} />}
    </div>
  )
}
