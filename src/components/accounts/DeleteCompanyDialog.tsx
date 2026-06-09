import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { scopeData } from '../../store/selectors'
import { serializeData } from '@floaty/shared/data/transfer'
import { todayISO } from '@floaty/shared/lib/dateMath'
import { downloadTextFile } from '../../lib/download'
import { Button, Modal, TextField } from '../common/ui'
import type { Account } from '@floaty/shared/types/entities'

// Friction for the one irreversible action in the app. Deleting a company cascade-
// drops all of its data with no undo, so we (a) offer a one-click export of that
// company's data first, and (b) require typing the exact name to arm the button.
export function DeleteCompanyDialog({
  account,
  onConfirm,
  onCancel,
}: {
  account: Account
  onConfirm: () => void
  onCancel: () => void
}) {
  const data = useStore((s) => s.data)
  const [typed, setTyped] = useState('')
  const matches = typed.trim() === account.name
  // Hint id so the disabled Delete button can point at the type-to-confirm instruction —
  // a screen reader then announces WHY Delete is unavailable, not just that it's disabled.
  const hintId = useId()

  // Export just this company's slice (same shape as the in-app export, which import
  // re-stamps into whichever account is active).
  const exportFirst = () => {
    const slug = account.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'company'
    downloadTextFile(`floaty-${slug}-${todayISO()}.json`, serializeData(scopeData(data, account.id)))
  }

  return (
    <Modal
      title="Delete company?"
      onClose={onCancel}
      // Confirmation-only: the type-to-confirm field is a gate, not savable data, so don't
      // let the unsaved-changes guard refuse Escape/backdrop once the user starts typing.
      guardDirty={false}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!matches} onClick={onConfirm} describedById={hintId}>
            Delete
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Delete <span className="font-medium text-ink">{account.name}</span> and all of its data
        (resources, projects, allocations…)? This cannot be undone.
      </p>
      <div className="flex justify-start">
        <Button variant="ghost" onClick={exportFirst}>
          Export first
        </Button>
      </div>
      <TextField
        label={`Type “${account.name}” to confirm`}
        value={typed}
        onChange={setTyped}
        autoFocus
      />
      <p id={hintId} className="text-xs text-muted">
        Type the company name exactly to enable Delete.
      </p>
    </Modal>
  )
}
