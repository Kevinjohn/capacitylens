import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { validateName } from '../../lib/validation'
import { Button, FieldError, ListPage, TextField } from '../common/ui'
import type { ThemePref } from '../../lib/theme'

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match system' },
]

// App-level preferences, opened from the nav like the CRUD list pages. Two
// sections for now: rename the active company, and pick the colour scheme.
export function SettingsView() {
  const accounts = useStore((s) => s.data.accounts)
  const activeAccountId = useStore((s) => s.activeAccountId)
  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null
  const updateAccount = useStore((s) => s.updateAccount)
  const setNotice = useStore((s) => s.setNotice)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)

  const [name, setName] = useState(activeAccount?.name ?? '')
  const { error, errorField, errorId, fail } = useFieldError()

  // The shell only routes here with an active account chosen; this is defensive.
  if (!activeAccount) return null

  const saveName = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    if (trimmed === activeAccount.name) return
    updateAccount(activeAccount.id, { name: trimmed })
    setNotice('Company name updated.')
  }

  const nameUnchanged = name.trim() === activeAccount.name

  return (
    <ListPage title="Settings">
      <div className="space-y-6">
        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Company</h2>
          <div className="space-y-3">
            <TextField
              label="Company name"
              value={name}
              onChange={setName}
              invalid={errorField === 'name'}
              describedById={errorId}
            />
            <FieldError id={errorId}>{error}</FieldError>
            <div className="flex justify-end">
              <Button onClick={saveName} disabled={nameUnchanged}>
                Save
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Appearance</h2>
          <p className="mb-3 text-xs text-muted">
            Theme — applies to this browser. “Match system” follows your operating system.
          </p>
          <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-line p-0.5">
            {THEME_OPTIONS.map((opt) => {
              const selected = theme === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTheme(opt.value)}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                    selected ? 'bg-brand-soft text-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </ListPage>
  )
}
