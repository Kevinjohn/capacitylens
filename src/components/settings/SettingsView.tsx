import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { validateName } from '../../lib/validation'
import { Button, FieldError, ListPage, TextField } from '../common/ui'
import type { ThemePref } from '../../lib/theme'
import type { SchedulingMode } from '@floaty/shared/types/entities'

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match system' },
]

const SCHEDULING_OPTIONS: { value: SchedulingMode; label: string }[] = [
  { value: 'hourly', label: 'Hours' },
  { value: 'days', label: 'Days' },
]

const UTILIZATION_OPTIONS: { key: 'showTotal' | 'showDiscipline' | 'showPersonal'; label: string }[] = [
  { key: 'showTotal', label: 'Show Total Utilisation' },
  { key: 'showDiscipline', label: 'Show Discipline Utilisation' },
  { key: 'showPersonal', label: 'Show Personal Utilisation' },
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
  const utilizationPrefs = useStore((s) => s.utilizationPrefs)
  const setUtilizationPref = useStore((s) => s.setUtilizationPref)

  const schedulingMode: SchedulingMode = activeAccount?.schedulingMode ?? 'hourly'

  const accountName = activeAccount?.name ?? ''
  const [name, setName] = useState(accountName)
  const { error, errorField, errorId, fail } = useFieldError()

  // Re-sync the field when the account name changes underneath us (undo/redo, import,
  // or account switch) — the render-time reconcile pattern used in SchedulerToolbar.
  // While the user is merely typing, accountName is unchanged, so edits aren't clobbered.
  const [seenName, setSeenName] = useState(accountName)
  if (accountName !== seenName) {
    setSeenName(accountName)
    setName(accountName)
  }

  // The shell only routes here with an active account chosen; this is defensive.
  if (!activeAccount) return null

  const saveName = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    // The Save button is disabled while unchanged, so no redundant equality guard here.
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
          <h2 className="mb-1 text-sm font-semibold text-ink">Scheduling</h2>
          <p className="mb-3 text-xs text-muted">
            How allocations are entered. <strong>Hours</strong> asks for hours/day across a start and end
            date. <strong>Days</strong> asks for a start, days of work, and days over — the end date follows
            from how thinly the work is spread.
          </p>
          <div role="radiogroup" aria-label="Scheduling input" className="inline-flex rounded-md border border-line p-0.5">
            {SCHEDULING_OPTIONS.map((opt) => {
              const selected = schedulingMode === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => updateAccount(activeAccount.id, { schedulingMode: opt.value })}
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

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Utilisation</h2>
          <p className="mb-3 text-xs text-muted">
            Which utilisation figures appear on the scheduler.
          </p>
          <div className="divide-y divide-line">
            {UTILIZATION_OPTIONS.map((opt) => {
              const on = utilizationPrefs[opt.key]
              return (
                <div key={opt.key} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <span className="text-sm text-ink">{opt.label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={opt.label}
                    onClick={() => setUtilizationPref(opt.key, !on)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-brand' : 'bg-line'}`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-all ${
                        on ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
              )
            })}
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
