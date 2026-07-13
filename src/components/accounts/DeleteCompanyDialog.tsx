import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { scopeData } from '../../store/selectors'
import { serializeData } from '@capacitylens/shared/data/transfer'
import { todayISO } from '@capacitylens/shared/lib/dateMath'
import { isServerConfigured } from '../../data/apiConfig'
import {
  fetchInactiveSlice,
  InactiveSliceHttpError,
  InactiveSliceShapeError,
} from '../../data/fetchInactiveSlice'
import { downloadTextFile } from '../../lib/download'
import { errorMessage } from '../../lib/errorMessage'
import { m } from '@/i18n'
import { Button, Modal, TextField } from '../common/ui'
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities'
import type { AppData, ID } from '@capacitylens/shared/types/entities'

// Friction for the one irreversible action in the app. Deleting a company cascade-
// drops all of its data with no undo, so we (a) offer a one-click export of that
// company's data first, and (b) require typing the exact name to arm the button.
//
// `account` is the minimal { id, name } the dialog needs — so the AccountPicker can pass an
// AccountSummary (P1.13), which carries no colour/config.
//
// "Export first" sources per mode (this is a LAST backup before a no-undo cascade delete, so it
// must be COMPLETE):
//   • SERVER mode — the client store may hold NOTHING for this company (you can delete a company
//     you never switched into), and even a loaded slice is active-only (readSlice hides
//     archived/soft-deleted rows). So fetch the COMPLETE slice from the purge-gated admin read,
//     `GET /api/state?accountId=…&includeInactive=1` (the P2.6 complete per-tenant backup — the
//     same endpoint ArchivedSection uses). A failed or structurally incomplete fetch THROWS into
//     the inline error surface and no file is saved (DEFENSIVE-CODING §3: a failed backup never
//     saves a partial file and surfaces loudly — but export stays OPTIONAL; the user may already
//     hold their own backup, so a failed export disarms nothing once it has settled).
//   • DEMO build — the local blob IS the whole dataset (archived rows included), so
//     scopeData(data, id) is already complete; no fetch.
// Either way, an export that would contain ZERO scoped records is refused with a loud inline
// warning instead of silently saving an empty file the user would mistake for a real backup.
export function DeleteCompanyDialog({
  account,
  busy = false,
  onConfirm,
  onCancel,
}: {
  account: { id: ID; name: string }
  /** True while the caller's delete round-trip is in flight: disarms the confirm button so a
   *  double-click can't fire a second DELETE (which 403s in auth-on mode — the membership is
   *  already erased — raising a spurious error toast after a successful delete). Optional so the
   *  demo build's synchronous delete path needn't thread it. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const data = useStore((s) => s.data)
  const [typed, setTyped] = useState('')
  // Surface a failed "export first" inline: this is the LAST backup before a no-undo cascade delete,
  // so a silently-failed export (the user thinks they're covered, then deletes) is the worst case.
  const [exportError, setExportError] = useState<string | null>(null)
  // Separate from exportError: an all-empty slice is a WARNING ("no file was saved — is that
  // expected?"), not a failure, and must not carry the error path's "get a backup first" suffix
  // (backing up an empty company is impossible advice). Mutually exclusive with exportError.
  const [exportEmpty, setExportEmpty] = useState(false)
  // True while an export attempt is pending. Disarms BOTH buttons: Delete, so the no-undo cascade
  // can't race the in-flight backup (deleting mid-fetch would erase the very slice being saved);
  // Export, so a double-click can't start a second overlapping fetch. Once the attempt settles —
  // success OR failure — Delete re-arms: export is deliberately optional (the user may already
  // hold their own backup), so a failed export warns loudly but never locks the dialog.
  const [exporting, setExporting] = useState(false)
  const matches = typed.trim() === account.name
  // Hint id so the disabled Delete button can point at the type-to-confirm instruction —
  // a screen reader then announces WHY Delete is unavailable, not just that it's disabled.
  const hintId = useId()

  // SERVER mode: fetch the COMPLETE per-tenant slice (archived + soft-deleted retained) via the
  // shared, body-validating fetchInactiveSlice — see the header comment and that helper's TSDoc
  // (it enforces the structural gate BEFORE migrate(), shared with ArchivedSection so the two
  // readers of this endpoint can't drift on trust). Any failure — a non-OK response (including a
  // 403 for a non-admin) or a structurally incomplete body — is re-thrown here with this dialog's
  // user-facing sentence so the export visibly fails inline and can never save a partial/empty
  // backup.
  const fetchCompleteSlice = async (): Promise<AppData> => {
    try {
      return await fetchInactiveSlice(account.id)
    } catch (e) {
      // Re-throw with the export-specific i18n sentence (prefer the server's own sentence on a
      // non-OK response); exportFirst's catch routes the message to the inline error surface.
      if (e instanceof InactiveSliceHttpError) {
        throw new Error(
          e.serverMessage ?? m.dialog_delete_company_export_fetch_failed({ status: e.status }),
          { cause: e },
        )
      }
      if (e instanceof InactiveSliceShapeError) {
        throw new Error(m.dialog_delete_company_export_incomplete(), { cause: e })
      }
      throw e // network/parse failure — errorMessage(e) in exportFirst surfaces it verbatim.
    }
  }

  // Export just this company's slice (same shape as the in-app export, which import
  // re-stamps into whichever account is active).
  const exportFirst = async () => {
    const slug = account.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'company'
    setExporting(true)
    try {
      // scopeData narrows both sources identically: the fetched server slice is already
      // single-account (it just re-filters and blanks `accounts`, matching the demo export shape);
      // the demo blob genuinely needs the account filter.
      const scoped = scopeData(isServerConfigured() ? await fetchCompleteSlice() : data, account.id)
      // Zero-record guard: every real slice carries at least the built-in Internal client, so an
      // all-empty scoped export means the company's data never reached us (or the company is
      // genuinely empty). Refuse to save a file the user would mistake for a real backup.
      const total = SCOPED_KEYS.reduce((n, key) => n + scoped[key].length, 0)
      if (total === 0) {
        setExportError(null)
        setExportEmpty(true)
        return
      }
      downloadTextFile(`capacitylens-${slug}-${todayISO()}.json`, serializeData(scoped))
      setExportError(null)
      setExportEmpty(false)
    } catch (e) {
      // The backup did NOT save (fetch, serialize or download failed). Make it loud and inline so
      // the user does NOT proceed to delete believing they have an export they don't. Export and
      // Delete are separate steps, so they can retry or back out.
      setExportEmpty(false)
      setExportError(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      title={m.dialog_delete_company_title()}
      onClose={onCancel}
      // Confirmation-only: the type-to-confirm field is a gate, not savable data, so don't
      // let the unsaved-changes guard refuse Escape/backdrop once the user starts typing.
      guardDirty={false}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {m.form_cancel()}
          </Button>
          <Button
            variant="danger"
            disabled={!matches || busy || exporting}
            onClick={onConfirm}
            describedById={hintId}
          >
            {m.form_delete()}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        {m.dialog_delete_company_body_prefix()}<span className="font-medium text-ink">{account.name}</span>{m.dialog_delete_company_body_suffix()}
      </p>
      <div className="flex justify-start">
        <Button variant="ghost" disabled={exporting} onClick={() => void exportFirst()}>
          {m.dialog_delete_company_export_first()}
        </Button>
      </div>
      {exportError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {exportError}{m.dialog_delete_company_export_failed_suffix()}
        </p>
      )}
      {exportEmpty && (
        <p role="alert" className="text-sm font-medium text-danger">
          {m.dialog_delete_company_export_empty()}
        </p>
      )}
      <TextField
        label={m.dialog_delete_company_confirm_label({ name: account.name })}
        value={typed}
        onChange={setTyped}
        autoFocus
      />
      <p id={hintId} className="text-xs text-muted">
        {m.dialog_delete_company_hint()}
      </p>
    </Modal>
  )
}
