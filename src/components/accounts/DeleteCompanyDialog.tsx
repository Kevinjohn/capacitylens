import { useId, useState } from "react";
import { useStore } from "../../store/useStore";
import { scopeData } from "../../store/selectors";
import { serializeData } from "@capacitylens/shared/data/transfer";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import { isServerConfigured } from "../../data/apiConfig";
import { fetchInactiveSlice, InactiveSliceHttpError, InactiveSliceShapeError } from "../../data/fetchInactiveSlice";
import { downloadTextFile } from "../../lib/download";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { m } from "@/i18n";
import { Modal, TextField } from "../common/ui";
import { Button } from "../ui/button";
import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import type { AppData, ID } from "@capacitylens/shared/types/entities";

function useCompanyExport(account: { id: ID; name: string }) {
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportEmpty, setExportEmpty] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fetchCompleteSlice = async (): Promise<AppData> => {
    try {
      return await fetchInactiveSlice(account.id);
    } catch (error) {
      if (error instanceof InactiveSliceHttpError) {
        throw new Error(error.serverMessage ?? m.dialog_delete_company_export_fetch_failed({ status: error.status }), {
          cause: error,
        });
      }
      if (error instanceof InactiveSliceShapeError) {
        throw new Error(m.dialog_delete_company_export_incomplete(), { cause: error });
      }
      throw error;
    }
  };
  const exportFirst = async () => {
    const slug =
      account.name
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "company";
    setExporting(true);
    try {
      const source = isServerConfigured() ? await fetchCompleteSlice() : useStore.getState().data;
      const scoped = scopeData(source, account.id);
      const total = SCOPED_KEYS.reduce((itemCount, key) => itemCount + scoped[key].length, 0);
      if (total === 0) {
        setExportError(null);
        setExportEmpty(true);
        return;
      }
      downloadTextFile(`capacitylens-${slug}-${todayISO()}.json`, serializeData(scoped));
      setExportError(null);
      setExportEmpty(false);
    } catch (error) {
      setExportEmpty(false);
      setExportError(resolveErrorMessage(error));
    } finally {
      setExporting(false);
    }
  };
  return { exportError, exportEmpty, exporting, exportFirst };
}

function DeleteFooter({
  busy,
  exporting,
  matches,
  hintId,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  exporting: boolean;
  matches: boolean;
  hintId: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
        {m.form_cancel()}
      </Button>
      <Button
        size="sm"
        variant="danger-soft"
        disabled={busy || exporting}
        aria-disabled={!matches || undefined}
        onClick={() => {
          if (matches && !busy && !exporting) onConfirm();
        }}
        aria-describedby={hintId}
        className="aria-disabled:opacity-50"
      >
        {m.form_delete()}
      </Button>
    </>
  );
}

function DeleteCompanyMessages({
  accountName,
  exportError,
  exportEmpty,
}: {
  accountName: string;
  exportError: string | null;
  exportEmpty: boolean;
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {m.dialog_delete_company_body_prefix()}
        <span className="font-medium text-ink">{accountName}</span>
        {m.dialog_delete_company_body_suffix()}
      </p>
      {exportError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {exportError}
          {m.dialog_delete_company_export_failed_suffix()}
        </p>
      )}
      {exportEmpty && (
        <p role="alert" className="text-sm font-medium text-danger">
          {m.dialog_delete_company_export_empty()}
        </p>
      )}
    </>
  );
}

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
  account: { id: ID; name: string };
  /** True while the caller's delete round-trip is in flight: disarms the confirm button so a
   *  double-click can't fire an overlapping DELETE that may still be in progress and raise a
   *  spurious retry error after a successful delete. Optional so the demo build's synchronous
   *  delete path needn't thread it. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const { exportError, exportEmpty, exporting, exportFirst } = useCompanyExport(account);
  const matches = typed.trim().normalize("NFC") === account.name.trim().normalize("NFC");
  // Hint id so the disabled Delete button can point at the type-to-confirm instruction —
  // a screen reader then announces WHY Delete is unavailable, not just that it's disabled.
  const hintId = useId();

  // SERVER mode: fetch the COMPLETE per-tenant slice (archived + soft-deleted retained) via the
  // shared, body-validating fetchInactiveSlice — see the header comment and that helper's TSDoc
  // (it enforces the structural gate BEFORE migrate(), shared with ArchivedSection so the two
  // readers of this endpoint can't drift on trust). Any failure — a non-OK response (including a
  // 403 for a non-admin) or a structurally incomplete body — is re-thrown here with this dialog's
  // user-facing sentence so the export visibly fails inline and can never save a partial/empty
  // backup.
  // Export just this company's slice (same shape as the in-app export, which import
  // re-stamps into whichever account is active).
  return (
    <Modal
      title={m.dialog_delete_company_title()}
      onClose={() => {
        if (!busy) onCancel();
      }}
      // Confirmation-only: the type-to-confirm field is a gate, not savable data, so don't
      // let the unsaved-changes guard refuse Escape/backdrop once the user starts typing.
      guardDirty={false}
      footer={
        <DeleteFooter
          busy={busy}
          exporting={exporting}
          matches={matches}
          hintId={hintId}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      }
    >
      <DeleteCompanyMessages accountName={account.name} exportError={exportError} exportEmpty={exportEmpty} />
      <div className="flex justify-start">
        <Button size="sm" variant="outline" disabled={busy || exporting} onClick={() => void exportFirst()}>
          {m.dialog_delete_company_export_first()}
        </Button>
      </div>
      <TextField
        label={m.dialog_delete_company_confirm_label({ name: account.name })}
        value={typed}
        onChange={setTyped}
        autoFocus
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        {m.dialog_delete_company_hint()}
      </p>
    </Modal>
  );
}
