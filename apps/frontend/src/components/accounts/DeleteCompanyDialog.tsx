import { useId, useState } from "react";
import { useStore } from "@/store/useStore";
import { scopeData } from "@/store/selectors";
import { serializeData } from "@capacitylens/shared/data/transfer";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import { isServerConfigured } from "@/data/apiConfig";
import { fetchInactiveSlice, InactiveSliceHttpError, InactiveSliceShapeError } from "@/data/fetchInactiveSlice";
import { downloadTextFile } from "@/lib/download";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { m } from "@/i18n";
import { Modal, TextField } from "@/components/common/ui";
import { Button } from "@/components/ui/button";
import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import type { AppData, ID } from "@capacitylens/shared/types/entities";

// Validate a complete tenant slice before saving a backup; surface failures instead of saving a partial file.
function useCompanyExport(account: { id: ID; name: string }) {
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportEmpty, setExportEmpty] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fetchCompleteSlice = async (): Promise<AppData> => {
    try {
      return await fetchInactiveSlice(account.id);
    } catch (error) {
      // Translate HTTP and structural backup failures into user-safe export messages while preserving their causes.
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
      // A failed export must remain visible while leaving optional deletion available after the request settles.
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

// Company deletion cannot be undone, so it requires exact-name confirmation and offers a complete backup. Server backups fetch the full tenant including inactive rows; the demo scopes the local dataset. Export remains optional, but failures must never save a partial or empty file.
/** Confirms company deletion after exact-name entry and offers a complete backup. The caller and server own the ownership check. */
export function DeleteCompanyDialog({
  account,
  busy = false,
  onConfirm,
  onCancel,
}: {
  account: { id: ID; name: string };
  /** Disables confirmation while the deletion request is in flight so a second click cannot send an overlapping command. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const { exportError, exportEmpty, exporting, exportFirst } = useCompanyExport(account);
  const matches = typed.trim().normalize("NFC") === account.name.trim().normalize("NFC");
  // Hint id so the disabled Delete button can point at the type-to-confirm instruction,
  // a screen reader then announces why Delete is unavailable, not just that it's disabled.
  const hintId = useId();

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
