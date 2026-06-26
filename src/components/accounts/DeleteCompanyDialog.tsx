import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { scopeData } from '../../store/selectors'
import { serializeData } from '@capacitylens/shared/data/transfer'
import { todayISO } from '@capacitylens/shared/lib/dateMath'
import { downloadTextFile } from '../../lib/download'
import { errorMessage } from '../../lib/errorMessage'
import { Button, Modal, TextField } from '../common/ui'
import type { ID } from '@capacitylens/shared/types/entities'

// Friction for the one irreversible action in the app. Deleting a company cascade-
// drops all of its data with no undo, so we (a) offer a one-click export of that
// company's data first, and (b) require typing the exact name to arm the button.
//
// `account` is the minimal { id, name } the dialog needs — so the AccountPicker can pass an
// AccountSummary (P1.13), which carries no colour/config. The "Export first" uses scopeData(data, id)
// = the active account's loaded slice; a company whose slice isn't loaded exports an empty file
// (acceptable — you delete the company you're in, and type-to-confirm is the real guard).
export function DeleteCompanyDialog({
  account,
  onConfirm,
  onCancel,
}: {
  account: { id: ID; name: string }
  onConfirm: () => void
  onCancel: () => void
}) {
  const data = useStore((s) => s.data)
  const [typed, setTyped] = useState('')
  // Surface a failed "export first" inline: this is the LAST backup before a no-undo cascade delete,
  // so a silently-failed export (the user thinks they're covered, then deletes) is the worst case.
  const [exportError, setExportError] = useState<string | null>(null)
  const matches = typed.trim() === account.name
  // Hint id so the disabled Delete button can point at the type-to-confirm instruction —
  // a screen reader then announces WHY Delete is unavailable, not just that it's disabled.
  const hintId = useId()

  // Export just this company's slice (same shape as the in-app export, which import
  // re-stamps into whichever account is active).
  const exportFirst = () => {
    const slug = account.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'company'
    try {
      downloadTextFile(`capacitylens-${slug}-${todayISO()}.json`, serializeData(scopeData(data, account.id)))
      setExportError(null)
    } catch (e) {
      // The backup did NOT save. Make it loud and inline so the user does NOT proceed to delete
      // believing they have an export they don't. Export and Delete are separate steps, so they can
      // retry or back out.
      setExportError(errorMessage(e))
    }
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
      {exportError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {exportError} Your data was not exported — do not delete until you have a backup.
        </p>
      )}
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
