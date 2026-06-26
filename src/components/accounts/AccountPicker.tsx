import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { FAKE_USER, useDemoAuthActive } from '../../lib/fakeAuth'
import { validateHex, validateName } from '../../lib/validation'
import { AddButton, Avatar, Button, ColorField, DeleteButton, FieldError, TextField } from '../common/ui'
import { DeleteCompanyDialog } from './DeleteCompanyDialog'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { AccountSummary } from '../../store/useStore'
import { APP_NAME } from '@capacitylens/shared/brand'

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
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  const previousAccountId = useStore((s) => s.previousAccountId)
  // If we got here via "Switch company" and that account is still in the list, offer a way back.
  const previous = accounts.find((a) => a.id === previousAccountId) ?? null
  // Cosmetic demo sign-in (see FakeSignIn): when the real auth seam is off, the picker is
  // the post-"login" screen, so show who's "signed in" + a Sign out back to the demo gate.
  const demoAuthActive = useDemoAuthActive()
  const signOutDemo = useStore((s) => s.signOutDemo)

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(DEFAULT_COLORS.account)
  const { error, errorField, errorId, fail } = useFieldError()
  const [confirming, setConfirming] = useState<AccountSummary | null>(null)

  const resetForm = () => {
    setCreating(false)
    setName('')
    setColor(DEFAULT_COLORS.account)
  }

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    if (!validateHex(color, fail)) return
    // Surface a store-side rejection as a form error rather than an uncaught React error. (addAccount
    // is the one CRUD action that works with no active account — bootstrapping the first tenant.)
    try {
      const account = addAccount({ name: trimmed, color })
      resetForm()
      setActiveAccount(account.id)
    } catch (e) {
      fail(null, errorMessage(e))
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">
        {demoAuthActive && (
          <div className="mb-4 flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-muted">
              Signed in as <span className="font-medium text-ink">{FAKE_USER.name}</span>
            </span>
            <button
              type="button"
              onClick={signOutDemo}
              className="shrink-0 text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Sign out
            </button>
          </div>
        )}
        {previous && (
          <button
            type="button"
            onClick={() => setActiveAccount(previous.id)}
            className="mb-4 text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            ← Back to {previous.name}
          </button>
        )}
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">Choose a company</h1>
          <p className="text-sm text-muted">Pick a company to plan, or create a new one.</p>
        </div>

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
              <DeleteButton label={`Delete ${a.name}`} onClick={() => setConfirming(a)} />
            </li>
          ))}
          {accounts.length === 0 && !creating && (
            <li className="rounded-lg border border-dashed bg-surface px-4 py-8 text-center text-sm text-muted">
              {/* Empty list has two meanings (P1.13): in server/auth-on mode the login simply has NO
                  memberships yet, so guide them to ask an admin (they may still create their own org
                  below); in local/OFF mode there are no companies on this device yet. One copy covers
                  both honestly — "create your first one" still applies (the New company button is below). */}
              No companies yet — create your first one, or ask an admin for an invite.
            </li>
          )}
        </ul>

        {creating ? (
          <form noValidate onSubmit={(e) => { e.preventDefault(); submit() }} className="mt-4 space-y-3 rounded-lg border border-line bg-surface p-4">
            <TextField
              label="Company name"
              value={name}
              onChange={setName}
              autoFocus
              invalid={errorField === 'name'}
              describedById={errorId}
            />
            <ColorField label="Colour" value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
            <FieldError id={errorId}>{error}</FieldError>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit">Create company</Button>
            </div>
          </form>
        ) : (
          <div className="mt-4">
            <AddButton label="New company" onClick={() => setCreating(true)} />
          </div>
        )}

        {confirming && (
          <DeleteCompanyDialog
            account={confirming}
            onConfirm={() => {
              deleteAccount(confirming.id)
              setConfirming(null)
            }}
            onCancel={() => setConfirming(null)}
          />
        )}
      </div>
    </div>
  )
}
