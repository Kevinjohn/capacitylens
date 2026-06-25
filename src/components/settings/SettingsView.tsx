import { useState } from 'react'
import { useAuth } from '../../auth/authContext'
import { buildStamp, feedbackMailto } from '../../data/buildInfo'
import { isServerConfigured } from '../../data/apiConfig'
import { clearFloatyLocalStorage } from '../../data/clearLocalStorage'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateName } from '../../lib/validation'
import { Button, ConfirmDialog, FieldError, ListPage, SegmentedControl, TextField } from '../common/ui'
import { cn } from '@/lib/utils'
import { EXTERNAL_EXPLAINER } from '../../lib/externalCopy'
import type { ThemePref } from '../../lib/theme'
import type { SchedulingMode } from '@floaty/shared/types/entities'

const WEEK_START_OPTIONS: { value: 0 | 1; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 0, label: 'Sunday' },
]

function supportedTimeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone') as string[]
    if (!zones.includes('Etc/GMT')) return ['Etc/GMT', ...zones]
    return zones
  } catch {
    // Fallback for older engines
    return ['Etc/GMT', 'UTC', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']
  }
}

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match system' },
]

const SCHEDULING_OPTIONS: { value: SchedulingMode; label: string }[] = [
  { value: 'hourly', label: 'Hours' },
  { value: 'days', label: 'Days' },
  { value: 'blocks', label: 'Blocks' },
]

const UTILIZATION_OPTIONS: { key: 'showTotal' | 'showDiscipline' | 'showPersonal'; label: string }[] = [
  { key: 'showTotal', label: 'Show Total Utilisation' },
  { key: 'showDiscipline', label: 'Show Discipline Utilisation' },
  { key: 'showPersonal', label: 'Show Personal Utilisation' },
]

const BAR_LABEL_OPTIONS: { key: 'showClient' | 'showProject'; label: string }[] = [
  { key: 'showClient', label: 'Show client name' },
  { key: 'showProject', label: 'Show project name' },
]

// The on/off switch row shared by the Allocation bars and Utilisation sections.
function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
      <span className="text-sm text-ink">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className={cn('relative h-5 w-9 shrink-0 rounded-full transition', on ? 'bg-brand' : 'bg-line')}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-all',
            on ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  )
}

// App-level preferences, opened from the nav like the CRUD list pages.
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
  const barLabelPrefs = useStore((s) => s.barLabelPrefs)
  const setBarLabelPref = useStore((s) => s.setBarLabelPref)
  const minimiseWeekends = useStore((s) => s.minimiseWeekends)
  const setMinimiseWeekends = useStore((s) => s.setMinimiseWeekends)

  const schedulingMode: SchedulingMode = activeAccount?.schedulingMode ?? 'hourly'
  const weekStartsOn: 0 | 1 = activeAccount?.weekStartsOn ?? 1
  const timezone: string = activeAccount?.timezone ?? 'Etc/GMT'
  const disciplinesEnabled: boolean = activeAccount?.disciplinesEnabled ?? true
  // Per-account view prefs (default OFF — absent reads as hidden), mirroring disciplinesEnabled
  // above. activeAccount is guaranteed non-null past the `if (!activeAccount) return null` below.
  const placeholdersEnabled: boolean = activeAccount?.placeholdersEnabled ?? false
  const externalEnabled: boolean = activeAccount?.externalEnabled ?? false
  const allZones = supportedTimeZones()
  const tzOptions = allZones.includes(timezone) ? allZones : [timezone, ...allZones]

  const accountName = activeAccount?.name ?? ''
  const [name, setName] = useState(accountName)
  const { error, errorField, errorId, fail } = useFieldError()
  const { authMode, user, signOut } = useAuth()

  // "Clear local storage" — a destructive, user-triggered wipe of everything Floaty keeps in THIS
  // browser (the persisted AppData + every device-global pref). The copy adapts to where the real
  // data lives: in server mode (VITE_FLOATY_API set) the DB is the source of truth and the reload
  // re-hydrates from it, so the local wipe is non-destructive to account data; in local mode this
  // erases the only copy. The reload re-initialises the app from whichever source applies.
  const [confirmingClear, setConfirmingClear] = useState(false)
  const serverMode = isServerConfigured()

  const clearLocalStorage = () => {
    // Surface, never swallow (DEFENSIVE-CODING.md §1): this is a user-triggered action, so a storage
    // failure (private mode / disabled storage) must show as a visible notice rather than vanish.
    try {
      clearFloatyLocalStorage()
    } catch (e) {
      setConfirmingClear(false)
      setNotice(`Could not clear local storage: ${errorMessage(e)}`, 'error')
      return
    }
    // Reload so the app re-initialises from scratch — from the server DB in server mode, or an
    // empty/seeded dataset in local mode. (No setConfirmingClear here: the page is going away.)
    window.location.reload()
  }

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
  const stamp = buildStamp()
  const feedback = feedbackMailto()

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
          <p className="mb-2 text-xs text-muted">How allocations are entered.</p>
          <ul className="mb-3 list-disc space-y-1 pl-4 text-xs text-muted">
            <li>
              <strong>Hours</strong> asks for hours/day across a start and end date.
            </li>
            <li>
              <strong>Days</strong> asks for a start, days of work, and days over — the end date follows from
              how thinly the work is spread.
            </li>
            <li>
              <strong>Blocks</strong> asks only for a start and days over — a pure booking with no load, so
              utilisation is ignored.
            </li>
          </ul>
          <SegmentedControl
            ariaLabel="Scheduling input"
            value={schedulingMode}
            onChange={(value) => updateAccount(activeAccount.id, { schedulingMode: value })}
            options={SCHEDULING_OPTIONS}
          />
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Calendar</h2>
          <p className="mb-3 text-xs text-muted">
            Applies to the whole team — sets which day starts the week and the time zone used to determine "today".
          </p>
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink">Week starts on</p>
              <SegmentedControl
                ariaLabel="Week starts on"
                value={weekStartsOn}
                onChange={(value) => updateAccount(activeAccount.id, { weekStartsOn: value })}
                options={WEEK_START_OPTIONS}
              />
            </div>
            <div>
              <label htmlFor="timezone-select" className="mb-1.5 block text-xs font-medium text-ink">
                Timezone
              </label>
              <select
                id="timezone-select"
                value={timezone}
                onChange={(e) => updateAccount(activeAccount.id, { timezone: e.target.value })}
                className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {tzOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz === 'Etc/GMT' ? 'GMT' : tz}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Disciplines</h2>
          <p className="mb-3 text-xs text-muted">
            Group people by discipline across the app. Turn this off if your team doesn't use
            disciplines — they're then hidden from the schedule, resource form and navigation. Your
            existing discipline data is kept and reappears if you turn it back on.
          </p>
          <div className="divide-y divide-line">
            <ToggleRow
              label="Use disciplines"
              on={disciplinesEnabled}
              onToggle={() => updateAccount(activeAccount.id, { disciplinesEnabled: !disciplinesEnabled })}
            />
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Schedule</h2>
          <p className="mb-3 text-xs text-muted">
            How the week grid is drawn — applies to this browser. Minimise weekends shrinks the
            Saturday and Sunday columns so the working week dominates the view. Weekend work still
            shows; the columns just narrow.
          </p>
          <div className="divide-y divide-line">
            <ToggleRow
              label="Minimise weekends"
              on={minimiseWeekends}
              onToggle={() => setMinimiseWeekends(!minimiseWeekends)}
            />
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Placeholders</h2>
          <p className="mb-3 text-xs text-muted">
            Placeholders are unfilled "slots" you can pencil in before a person is assigned —
            set per company. Off by default; when off they're hidden everywhere (the
            schedule, the assignee picker and the Resources list) but their data is kept.
          </p>
          <div className="divide-y divide-line">
            <ToggleRow
              label="Show placeholders"
              on={placeholdersEnabled}
              onToggle={() => updateAccount(activeAccount.id, { placeholdersEnabled: !placeholdersEnabled })}
            />
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">External</h2>
          {/* Explainer copy (editable, shared with the Resources-tab External section — see
              lib/externalCopy.ts). Set per company; off by default. */}
          <p className="mb-3 max-w-prose text-xs text-muted">{EXTERNAL_EXPLAINER}</p>
          <p className="mb-3 text-xs text-muted">
            Set per company. Off by default; when off externals are hidden everywhere (the
            schedule, the assignee picker and the Resources list) but their data is kept.
          </p>
          <div className="divide-y divide-line">
            <ToggleRow
              label="Show external resources"
              on={externalEnabled}
              onToggle={() => updateAccount(activeAccount.id, { externalEnabled: !externalEnabled })}
            />
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Allocation bars</h2>
          <p className="mb-3 text-xs text-muted">
            What each bar on the schedule shows before the activity name — applies to this browser.
          </p>
          <div className="divide-y divide-line">
            {BAR_LABEL_OPTIONS.map((opt) => (
              <ToggleRow
                key={opt.key}
                label={opt.label}
                on={barLabelPrefs[opt.key]}
                onToggle={() => setBarLabelPref(opt.key, !barLabelPrefs[opt.key])}
              />
            ))}
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Utilisation</h2>
          <p className="mb-3 text-xs text-muted">
            Which utilisation figures appear on the scheduler.
          </p>
          <div className="divide-y divide-line">
            {/* The per-discipline figure has nothing to attach to when disciplines are off. */}
            {UTILIZATION_OPTIONS.filter((opt) => disciplinesEnabled || opt.key !== 'showDiscipline').map((opt) => (
              <ToggleRow
                key={opt.key}
                label={opt.label}
                on={utilizationPrefs[opt.key]}
                onToggle={() => setUtilizationPref(opt.key, !utilizationPrefs[opt.key])}
              />
            ))}
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Appearance</h2>
          <p className="mb-3 text-xs text-muted">
            Theme — applies to this browser. “Match system” follows your operating system.
          </p>
          <SegmentedControl ariaLabel="Theme" value={theme} onChange={setTheme} options={THEME_OPTIONS} />
        </section>

        {/* Local data — a destructive maintenance action, kept near the bottom with danger
            styling so it can't be hit by accident. Wipes everything Floaty stores in THIS
            browser (data blob + device prefs); the wording + outcome depend on server vs local. */}
        <section className="rounded border border-danger/40 bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-danger">Local data</h2>
          <p className="mb-3 max-w-prose text-xs text-muted">
            {serverMode
              ? 'Clears the Floaty data and settings cached in this browser. Your account data lives in the database and is safe — the app reloads from there. This cannot be undone for this browser.'
              : 'Permanently clears the Floaty data and settings stored in this browser. In local mode this is your only copy, so this erases your data. This cannot be undone.'}
          </p>
          <Button variant="danger" testId="clear-local-storage" onClick={() => setConfirmingClear(true)}>
            Clear local storage
          </Button>
        </section>

        {confirmingClear && (
          <ConfirmDialog
            title="Clear local storage?"
            confirmLabel="Clear local storage"
            message={
              serverMode
                ? 'This permanently clears the Floaty data and settings stored in THIS browser, and cannot be undone. On this hosted site your data lives in the database and is safe — the app will reload and re-load it from there.'
                : 'This permanently clears the Floaty data and settings stored in THIS browser, and cannot be undone. In local mode this is your only copy, so this erases your local data.'
            }
            onConfirm={clearLocalStorage}
            onCancel={() => setConfirmingClear(false)}
          />
        )}

        {/* Account section (P3.3) — only on an auth-enabled deploy (authMode ≠ off, as
            reported by the server). Auth off and local mode render nothing here. */}
        {authMode !== 'off' && (
          <section className="rounded border border-line bg-surface p-4">
            <h2 className="mb-1 text-sm font-semibold text-ink">Account</h2>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">Signed in as {user?.email ?? user?.name ?? 'unknown'}</p>
              <Button variant="ghost" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          </section>
        )}

        {/* Build provenance footer (P1.7) + feedback link (P5.2) — only in builds the
            deploy script stamps; absent (today's Settings exactly) when both env vars
            are unset. The mailto subject carries the stamp so reports arrive pinned. */}
        {(stamp || feedback) && (
          <p className="flex items-center gap-3 text-xs text-muted">
            {stamp && <span data-testid="build-stamp">{stamp}</span>}
            {feedback && (
              <a
                data-testid="send-feedback"
                href={feedback}
                className="underline underline-offset-2 hover:text-ink"
              >
                Send feedback
              </a>
            )}
          </p>
        )}
      </div>
    </ListPage>
  )
}
