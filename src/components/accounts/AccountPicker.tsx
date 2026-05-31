import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { validateHex, validateName } from '../../lib/validation'
import { Avatar, Button, ColorField, FieldError, TextField } from '../common/ui'
import { DeleteCompanyDialog } from './DeleteCompanyDialog'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { Account } from '../../types/entities'

// Full-screen tenant chooser. Shown on every load (activeAccountId is never
// persisted) and whenever the user picks "Switch company". Lets you open an
// existing company, create one inline, or delete one (cascade-drops its data).
export function AccountPicker() {
  const accounts = useStore((s) => s.data.accounts)
  const addAccount = useStore((s) => s.addAccount)
  const deleteAccount = useStore((s) => s.deleteAccount)
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  const previousAccountId = useStore((s) => s.previousAccountId)
  // If we got here via "Switch company" and that account still exists, offer a way back.
  const previous = accounts.find((a) => a.id === previousAccountId) ?? null

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(DEFAULT_COLORS.account)
  const { error, errorField, errorId, fail } = useFieldError()
  const [confirming, setConfirming] = useState<Account | null>(null)

  const resetForm = () => {
    setCreating(false)
    setName('')
    setColor(DEFAULT_COLORS.account)
  }

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    if (!validateHex(color, fail)) return
    const account = addAccount({ name: trimmed, color })
    resetForm()
    setActiveAccount(account.id)
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">
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
          <div className="mb-1 text-2xl font-bold text-brand">Floaty</div>
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
                <Avatar name={a.name} color={a.color} />
                <span className="font-medium">{a.name}</span>
              </button>
              <Button variant="ghost" ariaLabel={`Delete ${a.name}`} onClick={() => setConfirming(a)}>
                Delete
              </Button>
            </li>
          ))}
          {accounts.length === 0 && !creating && (
            <li className="rounded-lg border border-dashed bg-surface px-4 py-8 text-center text-sm text-muted">
              No companies yet — create your first one.
            </li>
          )}
        </ul>

        {creating ? (
          <div className="mt-4 space-y-3 rounded-lg border border-line bg-surface p-4">
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
              <Button onClick={submit}>Create company</Button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <Button onClick={() => setCreating(true)}>New company</Button>
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
