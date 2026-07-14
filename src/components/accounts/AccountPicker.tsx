import { useState } from 'react'
import { API_BASE, isServerConfigured } from '../../data/apiConfig'
import { apiFetch, API_BULK_TIMEOUT_MS } from '../../data/requestTimeout'
import { useStore } from '../../store/useStore'
import { useAuth } from '../../auth/authContext'
import { fetchAccountSummaries } from '../../auth/useAccountSummaries'
import { readApiError } from '../../lib/readApiError'
import { can } from '@capacitylens/shared/domain/access'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { FAKE_USER, useDemoAuthActive } from '../../lib/fakeAuth'
import { validateName } from '../../lib/validation'
import { AddButton, Avatar, Button, DeleteButton, FieldError, SegmentedControl, TextField } from '../common/ui'
import { supportedTimeZones, timeZoneOptionLabel } from '../../lib/timezones'
import { DeleteCompanyDialog } from './DeleteCompanyDialog'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { AccountSummary } from '../../store/useStore'
import { APP_NAME } from '@capacitylens/shared/brand'
import { m } from '@/i18n'

// Onboarding capture (P1.14): the create-company form sets language, week-start and time zone —
// the three fields the server FREEZES after creation (a later change → 409). They're captured here,
// with concrete defaults (never undefined: an unset frozen value can't be set later), and disabled
// in Settings. English-only until P1.5.1 (Paraglide), so Language is a fixed display, not a chooser.
// Company colour keeps the default preset automatically; there is no one-off colour decision in
// the onboarding path.
// Each option's `label` is a GETTER (`() => m.key()`), not a pre-resolved string — the AppShell LINKS
// pattern (P1.5.2). Resolving at import would freeze the label to the load-time locale; the getter
// defers it to render so an account/locale switch re-resolves the text (mapped at the call site).
const WEEK_START_OPTIONS: { value: 0 | 1; label: () => string }[] = [
  { value: 1, label: () => m.picker_week_monday() },
  { value: 0, label: () => m.picker_week_sunday() },
]
const DEFAULT_WEEK_STARTS_ON = 1 as const
const DEFAULT_TIMEZONE = 'Etc/GMT'
const DEFAULT_LANGUAGE = 'en'

/** Validate the UNTRUSTED 2xx body of POST /api/orgs — same stance as useAccountSummaries'
 *  `toSummary` (the server is external input; never trust an `as` cast). Returns null when the
 *  body is unusable (not an object, or id/name missing/empty) — the caller must then treat the
 *  create as "succeeded, but id unknown", NOT as a failure (see createOrgOnServer). */
function toCreatedOrg(body: unknown): { id: string; name: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as { id?: unknown; name?: unknown }
  if (typeof b.id !== 'string' || b.id.length === 0) return null
  if (typeof b.name !== 'string' || b.name.length === 0) return null
  return { id: b.id, name: b.name }
}

// Full-screen tenant chooser. Shown on every load (activeAccountId is never
// persisted) and whenever the user picks "Switch company". Lets you open an
// existing company, create one inline, or delete one (cascade-drops its data).
//
// The list comes from `accountSummaries` (P1.13), NOT `data.accounts`: in server mode `data` holds
// only the ACTIVE account's slice, so it can't list the login's OTHER tenants — `accountSummaries`
// (server-sourced from GET /api/accounts; local-derived from data.accounts) is the only complete list.
export function AccountPicker() {
  const accounts = useStore((s) => s.accountSummaries)
  const addAccount = useStore((s) => s.addAccount)
  const deleteAccount = useStore((s) => s.deleteAccount)
  const setAccountSummaries = useStore((s) => s.setAccountSummaries)
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  const setNotice = useStore((s) => s.setNotice)
  const previousAccountId = useStore((s) => s.previousAccountId)
  // If we got here via "Switch company" and that account is still in the list, offer a way back.
  const previous = accounts.find((a) => a.id === previousAccountId) ?? null
  // Cosmetic demo sign-in (see FakeSignIn): when the real auth seam is off, the picker is
  // the post-"login" screen, so show who's "signed in" + a Sign out back to the demo gate.
  const demoAuthActive = useDemoAuthActive()
  const signOutDemo = useStore((s) => s.signOutDemo)
  // Hide the create affordance whenever the server says a create would be refused
  // (canCreateAccount: false — the single-company cap, or auth-on with no owner/admin standing).
  // Fails open to `true` (see authContext.ts) whenever the fact is unavailable, so a
  // self-hosted/demo build with no policy in place is unaffected. `refreshAuth` re-asks /me after
  // an org create/delete — the server recomputes canCreateAccount per request, so those are exactly
  // the moments the boot-time snapshot goes stale (see the call sites below).
  const { canCreateAccount, refreshAuth } = useAuth()

  const [creating, setCreating] = useState(false)
  // True while the server-mode create POST is in flight — guards the double-submit a slow /api/orgs
  // round-trip would otherwise allow (two companies from one form). Demo-mode create is synchronous.
  const [submitting, setSubmitting] = useState(false)
  // True while the server-mode DELETE is in flight — passed to the dialog as `busy` so the armed
  // Delete button disarms during the round-trip. Without it a double-click sends a second DELETE,
  // which 403s in auth-on mode (the membership was just erased) → a spurious "Forbidden." toast
  // right after a successful delete. Demo-mode delete is synchronous and never sets it.
  const [deleting, setDeleting] = useState(false)
  const [name, setName] = useState('')
  // The three frozen-after-creation fields (P1.14), captured here with concrete defaults.
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(DEFAULT_WEEK_STARTS_ON)
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE)
  const { error, errorField, errorId, fail } = useFieldError()
  const [confirming, setConfirming] = useState<AccountSummary | null>(null)
  const tzOptions = supportedTimeZones()

  const resetForm = () => {
    setCreating(false)
    setName('')
    setWeekStartsOn(DEFAULT_WEEK_STARTS_ON)
    setTimezone(DEFAULT_TIMEZONE)
  }

  // SERVER-mode create goes through POST /api/orgs — the ATOMIC account + built-in Internal client +
  // caller-as-Owner membership path — NOT the local addAccount + snapshot-diff sync. The generic
  // batch path can only write the bare account row: in auth-on mode the batch's scoped Internal-client
  // op 403s (the creator has no membership yet), so the company would appear to be created, raise a
  // persistence error, and vanish on reload — and no membership would ever exist server-side (the
  // P1.13 client migration the server's /api/orgs comment was waiting on). The three frozen fields
  // ride in the body; the server sanitizes/validates them exactly like the generic account write.
  const createOrgOnServer = async (trimmed: string) => {
    setSubmitting(true)
    try {
      const res = await apiFetch(`${API_BASE}/api/orgs`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, color: DEFAULT_COLORS.account, weekStartsOn, timezone, language: DEFAULT_LANGUAGE }),
      })
      if (!res.ok) {
        // The server's message (single-company cap / org-create gate) is the useful one; the
        // status-stamped fallback covers an unreadable body.
        fail(null, (await readApiError(res)) ?? m.picker_err_create({ status: res.status }))
        return
      }
      // A 2xx means the org EXISTS server-side no matter what the body looks like, so the body
      // read must NOT be allowed to throw into the transport catch below — that would surface an
      // error over a create that SUCCEEDED and leave the form open for a resubmit (a duplicate
      // company, or a spurious single-company-cap 403). Parse best-effort, validate the shape.
      const created = toCreatedOrg(await res.json().catch(() => null))
      if (created === null) {
        // DELIBERATE ASYMMETRY with the !res.ok branch: this is a SUCCESS with an unusable body,
        // not a failure. We can't seed a summary or activate (no trustworthy id — a bogus one
        // would slip past setActiveAccount's validation and load a nameless shell), so close the
        // form (resubmit = duplicate) and refetch the authoritative list instead: the new company
        // appears in the picker and the user opens it from there. A null refetch leaves the list
        // as-is — AppShell's own summaries fetch backstops on the next mount.
        resetForm()
        const list = await fetchAccountSummaries()
        if (list !== null) setAccountSummaries(list)
        // The create changed the facts /me computes (account count, the caller's owner standing) —
        // re-ask so canCreateAccount tracks it (e.g. the button hides once a capped instance fills
        // up). refreshAuth is TOTAL (never rejects — degrades to the stale snapshot with a warn),
        // so fire-and-forget is safe.
        void refreshAuth()
        return
      }
      // Seed the summary BEFORE activating: setActiveAccount validates ids against
      // data.accounts ∪ accountSummaries, and the just-created org is in neither yet.
      // Append-if-absent so a concurrent summaries refetch can't duplicate it.
      const summaries = useStore.getState().accountSummaries
      if (!summaries.some((a) => a.id === created.id)) {
        setAccountSummaries([...summaries, { id: created.id, name: created.name, role: 'owner' as const }])
      }
      resetForm()
      setActiveAccount(created.id) // the persist switch orchestrator hydrates the new slice
      // Same re-ask as the unusable-body branch above: the create moved the server-side facts
      // behind canCreateAccount. Total, so fire-and-forget is safe.
      void refreshAuth()
    } catch (e) {
      // Once dispatched, a transport rejection cannot tell us whether the atomic create committed.
      // Reconcile first and close the form so an immediate retry cannot mint a duplicate company.
      const list = await fetchAccountSummaries()
      if (list !== null) setAccountSummaries(list)
      await refreshAuth()
      resetForm()
      setNotice(
        `The create request had an unknown outcome. The company list was refreshed; check it before trying again. ${errorMessage(e)}`,
        'warning',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const submit = () => {
    // In-flight guard, self-contained (not just the button's `disabled` attribute): a POST already
    // in flight means any further submit — however triggered — must be a no-op, or one form could
    // create two companies.
    if (submitting) return
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    // Pass the three frozen fields as CONCRETE values (never undefined): the server freezes them after
    // creation, so an unset value here could never be set later — stranding the user (P1.14, TRAP 4).
    if (isServerConfigured()) {
      void createOrgOnServer(trimmed)
      return
    }
    // DEMO build: local store create. Surface a store-side rejection as a form error rather than an
    // uncaught React error. (addAccount is the one CRUD action that works with no active account —
    // bootstrapping the first tenant.)
    try {
      const account = addAccount({ name: trimmed, color: DEFAULT_COLORS.account, weekStartsOn, timezone, language: DEFAULT_LANGUAGE })
      resetForm()
      setActiveAccount(account.id)
    } catch (e) {
      fail(null, errorMessage(e))
    }
  }

  // SERVER-mode delete calls the dedicated DELETE route (gated 'purge' — admin+ — server-side; it
  // erases the whole tenant transactionally). The store's local deleteAccount can NOT do this job in
  // server mode: persistence diffs AppData snapshots, and in server mode `data` holds only the loaded
  // slice — "deleting" a company whose slice isn't loaded would diff to zero ops, delete nothing, and
  // the company would resurrect on the next summaries refetch. `data` is deliberately NOT mutated
  // here: the picker only renders with no active account, so a stale (now-deleted) slice in `data` is
  // invisible and gets replaced wholesale by the next account pick's loadAll.
  const deleteOrgOnServer = async (id: string) => {
    // In-flight guard, self-contained (the dialog's `busy` disable is the visible half): a second
    // DELETE for the same org 403s in auth-on mode — see the `deleting` state's comment.
    if (deleting) return
    setDeleting(true)
    try {
      const res = await apiFetch(
        `${API_BASE}/api/accounts/${encodeURIComponent(id)}`,
        { method: 'DELETE', credentials: 'include' },
        // Whole-tenant erasure is a BULK op — a transactional cascade over every scoped row plus
        // members' orphaned identities — so it gets the 120s bound, not the 15s interactive one. A
        // large tenant on a healthy-but-slow server must not be aborted mid-erase into a spurious
        // "delete failed" while the server actually committed the removal.
        API_BULK_TIMEOUT_MS,
      )
      if (!res.ok) {
        setNotice((await readApiError(res)) ?? m.picker_err_delete({ status: res.status }), 'error')
        return
      }
      const summaries = useStore.getState().accountSummaries
      setAccountSummaries(summaries.filter((s) => s.id !== id))
      // The delete flipped the facts /me computes: on a single-company instance, dropping the only
      // company back to zero accounts makes canCreateAccount true again (the bootstrap exemption).
      // Without this re-ask the picker would show the "ask an admin for an invite" empty state with
      // NO "New company" button — a dead end until a manual reload. refreshAuth is TOTAL (an
      // unresolved refresh keeps the stale value with a warn; the server 403 backstops), so
      // fire-and-forget is safe.
      void refreshAuth()
    } catch (e) {
      // A timeout/abort says only that the BROWSER stopped waiting — the transactional erasure may
      // already have COMMITTED server-side. Asserting "nothing was removed" here would leave a
      // now-deleted company in the picker (re-clicking it 403s) until a manual reload. Reconcile
      // instead: re-read the authoritative /api/accounts list and adopt it (the company drops out
      // if the erase committed; a failed re-read leaves the list untouched, same as before).
      const fresh = await fetchAccountSummaries()
      if (fresh !== null) setAccountSummaries(fresh)
      await refreshAuth()
      setNotice(
        `The delete request had an unknown outcome. The company list was refreshed — verify it before retrying. ${errorMessage(e)}`,
        'warning',
      )
    } finally {
      setDeleting(false)
      setConfirming(null)
    }
  }

  const confirmDelete = (id: string) => {
    if (isServerConfigured()) {
      void deleteOrgOnServer(id)
      return
    }
    // DEMO build: the local cascade drops the account and all its scoped data irreversibly.
    deleteAccount(id)
    setConfirming(null)
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">
        {demoAuthActive && (
          <div className="mb-4 flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-muted">
              {m.picker_signed_in_as()}<span className="font-medium text-ink">{FAKE_USER.name}</span>
            </span>
            <button
              type="button"
              onClick={signOutDemo}
              className="shrink-0 text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {m.picker_sign_out()}
            </button>
          </div>
        )}
        {previous && (
          <button
            type="button"
            onClick={() => setActiveAccount(previous.id)}
            className="mb-4 text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {m.picker_back({ name: previous.name })}
          </button>
        )}
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">
            {accounts.length === 0 ? m.picker_empty_title() : m.picker_title()}
          </h1>
          {/* At the single-company cap the create affordance is hidden (see below), so the
              subtitle must not promise "or create a new one" — that copy would point at nothing. */}
          <p className="text-sm text-muted">
            {accounts.length === 0
              ? canCreateAccount
                ? m.picker_empty_subtitle()
                : m.picker_empty_subtitle_no_create()
              : canCreateAccount
                ? m.picker_subtitle()
                : m.picker_subtitle_capped()}
          </p>
        </div>

        {accounts.length === 0 && !creating ? (
          <div data-testid="company-empty-options" className="mt-4 space-y-2">
            {canCreateAccount && (
              <div className="rounded-lg border border-line bg-surface p-3 shadow-sm">
                <AddButton label={m.picker_new()} onClick={() => setCreating(true)} testId="new-company-button" />
                <p className="mt-2 text-xs text-muted">{m.picker_empty_create_hint()}</p>
              </div>
            )}
            <div className="rounded-lg border border-line bg-surface px-3 py-3 text-sm text-muted shadow-sm">
              {m.picker_empty_invite()}
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveAccount(a.id)}
                  className="flex flex-1 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-ink shadow-sm transition hover:bg-canvas"
                >
                  {/* AccountSummary carries no colour (it's the minimal server-sourced shape — P1.13), so
                      the picker swatch uses the default account colour. The real per-account colour shows
                      once the slice is loaded; the picker pre-loads only id/name/role. */}
                  <Avatar name={a.name} color={DEFAULT_COLORS.account} />
                  <span className="font-medium">{a.name}</span>
                </button>
                {/* Company deletion is owner-only server-side, so every non-owner summary gets no
                    Delete affordance at all — offering one would let them type-to-confirm an
                    irreversible-looking action that then just 403s. Demo summaries are always 'owner'. */}
                {can(a.role, 'deleteAccount') && (
                  <DeleteButton label={m.picker_delete_company({ name: a.name })} onClick={() => setConfirming(a)} />
                )}
              </li>
            ))}
          </ul>
        )}

        {creating ? (
          <form noValidate onSubmit={(e) => { e.preventDefault(); submit() }} className="mt-4 space-y-3 rounded-lg border border-line bg-surface p-4">
            <TextField
              label={m.picker_company_name()}
              value={name}
              onChange={setName}
              autoFocus
              invalid={errorField === 'name'}
              describedById={errorId}
            />
            {/* The three calendar/locale facts captured at creation and FROZEN afterwards (P1.14). */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink">{m.picker_week_start()}</p>
              <SegmentedControl
                ariaLabel={m.picker_week_start()}
                value={weekStartsOn}
                onChange={setWeekStartsOn}
                options={WEEK_START_OPTIONS.map((o) => ({ value: o.value, label: o.label() }))}
              />
            </div>
            <div>
              <label htmlFor="create-timezone-select" className="mb-1.5 block text-xs font-medium text-ink">
                {m.picker_timezone()}
              </label>
              <select
                id="create-timezone-select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {tzOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {timeZoneOptionLabel(tz, tz === 'Etc/GMT' ? m.settings_timezone_gmt() : tz)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              {/* Language is English-only until P1.5.1 (Paraglide), so a fixed display, not a chooser. */}
              <p className="mb-1.5 text-xs font-medium text-ink">{m.picker_language()}</p>
              <p className="text-sm text-muted" data-testid="create-language">{m.picker_language_english()}</p>
            </div>
            <FieldError id={errorId}>{error}</FieldError>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={resetForm}>
                {m.picker_cancel()}
              </Button>
              <Button type="submit" disabled={submitting}>{m.picker_create()}</Button>
            </div>
          </form>
        ) : (
          // The button itself disappears whenever a create would be refused — the single-company
          // cap, or auth-on without owner/admin standing (a stricter read than disabling it —
          // there's nothing useful to do once it's hidden). canCreateAccount is kept FRESH, not
          // just read at boot: the server recomputes it per /me request, and this picker re-asks
          // (refreshAuth) after every org create/delete — so deleting the last company re-surfaces
          // this button via the zero-accounts bootstrap exemption, without a manual reload.
          accounts.length > 0 && canCreateAccount && (
            <div className="mt-4">
              <AddButton label={m.picker_new()} onClick={() => setCreating(true)} testId="new-company-button" />
            </div>
          )
        )}

        {confirming && (
          <DeleteCompanyDialog
            account={confirming}
            busy={deleting}
            onConfirm={() => confirmDelete(confirming.id)}
            onCancel={() => setConfirming(null)}
          />
        )}
      </div>
    </div>
  )
}
