import { useState } from 'react'
import { useAuth } from '../../auth/authContext'
import { buildStamp, feedbackMailto } from '../../data/buildInfo'
import { isServerConfigured } from '../../data/apiConfig'
import { clearCapacitylensLocalStorage } from '../../data/clearLocalStorage'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateName } from '../../lib/validation'
import { Button, ConfirmDialog, FieldError, ListPage, SegmentedControl, TextField } from '../common/ui'
import { MembersSection } from './MembersSection'
import { ArchivedSection } from './ArchivedSection'
import { supportedTimeZones } from '../../lib/timezones'
import { cn } from '@/lib/utils'
import { externalExplainer } from '../../lib/externalCopy'
import { m } from '@/i18n'
import type { ThemePref } from '../../lib/theme'
import type { SchedulingMode } from '@capacitylens/shared/types/entities'
import { APP_NAME } from '@capacitylens/shared/brand'

// Module-scope option lists carry a `label` GETTER (`() => m.key()`), not a pre-resolved string —
// the AppShell LINKS pattern (P1.5.2). Resolving `m.key()` at import would freeze the label to the
// load-time locale; the getter defers it to render so an account/locale switch re-resolves the text.
const WEEK_START_OPTIONS: { value: 0 | 1; label: () => string }[] = [
  { value: 1, label: () => m.settings_week_start_monday() },
  { value: 0, label: () => m.settings_week_start_sunday() },
]

const THEME_OPTIONS: { value: ThemePref; label: () => string }[] = [
  { value: 'light', label: () => m.settings_theme_light() },
  { value: 'dark', label: () => m.settings_theme_dark() },
  { value: 'system', label: () => m.settings_theme_system() },
]

const SCHEDULING_OPTIONS: { value: SchedulingMode; label: () => string }[] = [
  { value: 'hourly', label: () => m.settings_scheduling_option_hours() },
  { value: 'days', label: () => m.settings_scheduling_option_days() },
  { value: 'blocks', label: () => m.settings_scheduling_option_blocks() },
]

const UTILIZATION_OPTIONS: { key: 'showTotal' | 'showDiscipline' | 'showPersonal'; label: () => string }[] = [
  { key: 'showTotal', label: () => m.settings_utilisation_show_total() },
  { key: 'showDiscipline', label: () => m.settings_utilisation_show_discipline() },
  { key: 'showPersonal', label: () => m.settings_utilisation_show_personal() },
]

const BAR_LABEL_OPTIONS: { key: 'showClient' | 'showProject'; label: () => string }[] = [
  { key: 'showClient', label: () => m.settings_bar_labels_show_client() },
  { key: 'showProject', label: () => m.settings_bar_labels_show_project() },
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
  const snapToWeekStart = useStore((s) => s.snapToWeekStart)
  const setSnapToWeekStart = useStore((s) => s.setSnapToWeekStart)

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

  // "Clear local storage" — a destructive, user-triggered wipe of everything CapacityLens keeps in THIS
  // browser (the persisted AppData + every device-global pref). The copy adapts to where the real
  // data lives: in server mode (VITE_CAPACITYLENS_API set) the DB is the source of truth and the reload
  // re-hydrates from it, so the local wipe is non-destructive to account data; in local mode this
  // erases the only copy. The reload re-initialises the app from whichever source applies.
  const [confirmingClear, setConfirmingClear] = useState(false)
  const serverMode = isServerConfigured()

  const clearLocalStorage = () => {
    // Surface, never swallow (DEFENSIVE-CODING.md §1): this is a user-triggered action, so a storage
    // failure (private mode / disabled storage) must show as a visible notice rather than vanish.
    try {
      clearCapacitylensLocalStorage()
    } catch (e) {
      setConfirmingClear(false)
      setNotice(m.settings_err_clear_storage({ error: errorMessage(e) }), 'error')
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
    setNotice(m.settings_company_name_updated())
  }

  const nameUnchanged = name.trim() === activeAccount.name
  const stamp = buildStamp()
  const feedback = feedbackMailto()

  return (
    <ListPage title={m.settings_title()}>
      <div className="space-y-6">
        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{m.settings_company_heading()}</h2>
          <div className="space-y-3">
            <TextField
              label={m.settings_company_name_label()}
              value={name}
              onChange={setName}
              invalid={errorField === 'name'}
              describedById={errorId}
            />
            <FieldError id={errorId}>{error}</FieldError>
            <div className="flex justify-end">
              <Button onClick={saveName} disabled={nameUnchanged}>
                {m.settings_save()}
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_scheduling_heading()}</h2>
          <p className="mb-2 text-xs text-muted">{m.settings_scheduling_intro()}</p>
          <ul className="mb-3 list-disc space-y-1 pl-4 text-xs text-muted">
            <li>
              <strong>{m.settings_scheduling_hours_strong()}</strong>{m.settings_scheduling_hours_rest()}
            </li>
            <li>
              <strong>{m.settings_scheduling_days_strong()}</strong>{m.settings_scheduling_days_rest()}
            </li>
            <li>
              <strong>{m.settings_scheduling_blocks_strong()}</strong>{m.settings_scheduling_blocks_rest()}
            </li>
          </ul>
          <SegmentedControl
            ariaLabel={m.settings_scheduling_aria()}
            value={schedulingMode}
            onChange={(value) => updateAccount(activeAccount.id, { schedulingMode: value })}
            options={SCHEDULING_OPTIONS.map((o) => ({ value: o.value, label: o.label() }))}
          />
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_calendar_heading()}</h2>
          <p className="mb-1 text-xs text-muted">
            {m.settings_calendar_intro()}
          </p>
          {/* P1.14: language/week-start/time zone are captured when the company is created and FROZEN
              thereafter (the server returns 409 on a change). Disabled here, not removed, so the
              chosen values stay visible. */}
          <p className="mb-3 text-xs text-muted">{m.settings_calendar_frozen_hint()}</p>
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink">{m.settings_week_start_label()}</p>
              <SegmentedControl
                ariaLabel={m.settings_week_start_label()}
                value={weekStartsOn}
                onChange={(value) => updateAccount(activeAccount.id, { weekStartsOn: value })}
                options={WEEK_START_OPTIONS.map((o) => ({ value: o.value, label: o.label() }))}
                disabled
              />
            </div>
            <div>
              <label htmlFor="timezone-select" className="mb-1.5 block text-xs font-medium text-ink">
                {m.settings_timezone_label()}
              </label>
              <select
                id="timezone-select"
                value={timezone}
                disabled
                onChange={(e) => updateAccount(activeAccount.id, { timezone: e.target.value })}
                className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink disabled:cursor-not-allowed disabled:text-muted"
              >
                {tzOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz === 'Etc/GMT' ? m.settings_timezone_gmt() : tz}
                  </option>
                ))}
              </select>
            </div>
            <div>
              {/* Language is English-only until P1.5.1 (Paraglide); a read-only row, frozen like the
                  two above. Shown so the company's chosen language is visible even though it can't change. */}
              <p className="mb-1.5 text-xs font-medium text-ink">{m.settings_language_label()}</p>
              <p className="text-sm text-muted" data-testid="settings-language">{m.settings_language_value()}</p>
            </div>
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_disciplines_heading()}</h2>
          <p className="mb-3 text-xs text-muted">
            {m.settings_disciplines_intro()}
          </p>
          <div className="divide-y divide-line">
            <ToggleRow
              label={m.settings_disciplines_toggle()}
              on={disciplinesEnabled}
              onToggle={() => updateAccount(activeAccount.id, { disciplinesEnabled: !disciplinesEnabled })}
            />
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_schedule_heading()}</h2>
          <p className="mb-3 text-xs text-muted">
            {m.settings_schedule_intro()}
          </p>
          <div className="divide-y divide-line">
            <ToggleRow
              label={m.settings_schedule_minimise_weekends()}
              on={minimiseWeekends}
              onToggle={() => setMinimiseWeekends(!minimiseWeekends)}
            />
            <ToggleRow
              label={m.settings_schedule_snap_week_start()}
              on={snapToWeekStart}
              onToggle={() => setSnapToWeekStart(!snapToWeekStart)}
            />
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_placeholders_heading()}</h2>
          <p className="mb-3 text-xs text-muted">
            {m.settings_placeholders_intro()}
          </p>
          <div className="divide-y divide-line">
            <ToggleRow
              label={m.settings_placeholders_toggle()}
              on={placeholdersEnabled}
              onToggle={() => updateAccount(activeAccount.id, { placeholdersEnabled: !placeholdersEnabled })}
            />
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_external_heading()}</h2>
          {/* Explainer copy (editable, shared with the Resources-tab External section — see
              lib/externalCopy.ts). Set per company; off by default. */}
          <p className="mb-3 max-w-prose text-xs text-muted">{externalExplainer()}</p>
          <p className="mb-3 text-xs text-muted">
            {m.settings_external_intro()}
          </p>
          <div className="divide-y divide-line">
            <ToggleRow
              label={m.settings_external_toggle()}
              on={externalEnabled}
              onToggle={() => updateAccount(activeAccount.id, { externalEnabled: !externalEnabled })}
            />
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_bar_labels_heading()}</h2>
          <p className="mb-3 text-xs text-muted">
            {m.settings_bar_labels_intro()}
          </p>
          <div className="divide-y divide-line">
            {BAR_LABEL_OPTIONS.map((opt) => (
              <ToggleRow
                key={opt.key}
                label={opt.label()}
                on={barLabelPrefs[opt.key]}
                onToggle={() => setBarLabelPref(opt.key, !barLabelPrefs[opt.key])}
              />
            ))}
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_utilisation_heading()}</h2>
          <p className="mb-3 text-xs text-muted">
            {m.settings_utilisation_intro()}
          </p>
          <div className="divide-y divide-line">
            {/* The per-discipline figure has nothing to attach to when disciplines are off. */}
            {UTILIZATION_OPTIONS.filter((opt) => disciplinesEnabled || opt.key !== 'showDiscipline').map((opt) => (
              <ToggleRow
                key={opt.key}
                label={opt.label()}
                on={utilizationPrefs[opt.key]}
                onToggle={() => setUtilizationPref(opt.key, !utilizationPrefs[opt.key])}
              />
            ))}
          </div>
        </section>

        <section className="rounded border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_appearance_heading()}</h2>
          <p className="mb-3 text-xs text-muted">
            {m.settings_appearance_intro()}
          </p>
          <SegmentedControl
            ariaLabel={m.settings_appearance_aria()}
            value={theme}
            onChange={setTheme}
            options={THEME_OPTIONS.map((o) => ({ value: o.value, label: o.label() }))}
          />
        </section>

        {/* Local data — a destructive maintenance action, kept near the bottom with danger
            styling so it can't be hit by accident. Wipes everything CapacityLens stores in THIS
            browser (data blob + device prefs); the wording + outcome depend on server vs local. */}
        <section className="rounded border border-danger/40 bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-danger">{m.settings_local_data_heading()}</h2>
          <p className="mb-3 max-w-prose text-xs text-muted">
            {serverMode
              ? m.settings_clear_desc_server({ app: APP_NAME })
              : m.settings_clear_desc_local({ app: APP_NAME })}
          </p>
          <Button variant="danger" testId="clear-local-storage" onClick={() => setConfirmingClear(true)}>
            {m.settings_clear_storage_button()}
          </Button>
        </section>

        {confirmingClear && (
          <ConfirmDialog
            title={m.settings_clear_storage_confirm_title()}
            confirmLabel={m.settings_clear_storage_button()}
            message={
              serverMode
                ? m.settings_clear_confirm_server({ app: APP_NAME })
                : m.settings_clear_confirm_local({ app: APP_NAME })
            }
            onConfirm={clearLocalStorage}
            onCancel={() => setConfirmingClear(false)}
          />
        )}

        {/* Account section (P3.3) — only on an auth-enabled deploy (authMode ≠ off, as
            reported by the server). Auth off and local mode render nothing here. */}
        {authMode !== 'off' && (
          <section className="rounded border border-line bg-surface p-4">
            <h2 className="mb-1 text-sm font-semibold text-ink">{m.settings_account_heading()}</h2>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">{m.settings_signed_in_as({ who: user?.email ?? user?.name ?? m.settings_signed_in_unknown() })}</p>
              <Button variant="ghost" onClick={() => void signOut()}>
                {m.settings_account_sign_out()}
              </Button>
            </div>
          </section>
        )}

        {/* Member management (P1.11) — only on an auth-enabled, server-backed deploy, and the section
            self-gates further (a 403 on the members read hides it for a viewer/editor). OFF/local mode
            renders nothing. */}
        {authMode !== 'off' && <MembersSection />}

        {/* Archived & deleted (P2.5b) — the admin view of the data-lifecycle. Unlike Members it ALSO
            shows in LOCAL mode (everyone is owner locally); in SERVER mode it self-gates on a 403 from
            the inactive read (admin tier). Rendered unconditionally; the section decides its own
            visibility. */}
        <ArchivedSection />

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
                {m.settings_feedback_link()}
              </a>
            )}
          </p>
        )}
      </div>
    </ListPage>
  )
}
