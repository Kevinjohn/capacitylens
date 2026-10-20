import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { useScopedData } from "@/store/useScopedData";
import { parseData, serializeData } from "@capacitylens/shared/data/transfer";
import { downloadTextFile } from "@/lib/download";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { isServerConfigured } from "@/data/apiConfig";
import { fetchInactiveSlice, InactiveSliceHttpError, InactiveSliceShapeError } from "@/data/fetchInactiveSlice";
import { useRole } from "@/auth/permissionContext";
import { can, canSeePrivateNames } from "@capacitylens/shared/domain/access";
import { ConfirmDialog, Modal } from "./common/ui";
import { m } from "@/i18n";
import { buildUndoShortcut } from "@/lib/keyboardShortcuts";
import type { AppData } from "@capacitylens/shared/types/entities";
import { APP_NAME } from "@capacitylens/shared/brand";
import { Button } from "./ui/button";
import { reloadPage } from "@/lib/reloadPage";
import { useServerImport } from "./import-export/useServerImport";

// Store message getters so import-summary labels follow the active locale at render time.
const SUMMARY: [keyof AppData, () => string][] = [
  ["resources", () => m.data_summary_resources()],
  ["disciplines", () => m.data_summary_disciplines()],
  ["clients", () => m.data_summary_clients()],
  ["projects", () => m.data_summary_projects()],
  ["phases", () => m.data_summary_phases()],
  ["activities", () => m.data_summary_activities()],
  ["allocations", () => m.data_summary_allocations()],
  ["timeOff", () => m.data_summary_timeoff()],
  ["closures", () => m.data_summary_closures()],
];

function summarize(data: AppData): string {
  const parts = SUMMARY.filter(([key]) => data[key].length > 0).map(([key, label]) => `${data[key].length} ${label()}`);
  return parts.length ? parts.join(", ") : m.data_summary_none();
}

type PendingImport = { accountId: string | null; data: AppData; name: string };

function buildSkippedMessage(skipped: number, variant: "why" | "note"): string {
  if (skipped === 0) return "";
  if (variant === "why") {
    if (skipped === 1) return m.data_why_skipped_one({ count: skipped });
    return m.data_why_skipped_other({ count: skipped });
  }
  if (skipped === 1) return m.data_skipped_note_one({ count: skipped });
  return m.data_skipped_note_other({ count: skipped });
}

function buildImportedMessage(imported: number, skipped: number): string {
  const values = { count: imported, skipped: buildSkippedMessage(skipped, "note"), shortcut: buildUndoShortcut() };
  if (imported === 1) return m.data_imported_one(values);
  return m.data_imported_other(values);
}

function ImportProgress({ requiresReload }: { requiresReload: boolean }) {
  return (
    <Modal title={m.data_importing_title()} onClose={() => {}} guardDirty={false}>
      {requiresReload ? (
        <div className="flex flex-col gap-3">
          <p role="alert" data-testid="import-reload-required" className="text-sm text-muted-foreground">
            {m.data_import_unknown_reload_required()}
          </p>
          <Button type="button" size="sm" onClick={reloadPage}>
            {m.boundary_reload()}
          </Button>
        </div>
      ) : (
        <p tabIndex={0} data-testid="import-busy" className="text-sm text-muted-foreground">
          {m.data_importing_body()}
        </p>
      )}
    </Modal>
  );
}

function ImportConfirmation({
  pending,
  serverMode,
  onConfirm,
  onCancel,
}: {
  pending: PendingImport;
  serverMode: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const outro = serverMode
    ? m.data_import_confirm_outro_server()
    : m.data_import_confirm_outro({ shortcut: buildUndoShortcut() });
  return (
    <ConfirmDialog
      title={m.data_import_confirm_title()}
      confirmLabel={m.data_import_confirm_action()}
      message={
        <>
          {m.data_import_confirm_intro()}
          <span className="font-medium text-ink">{pending.name}</span>
          {m.data_import_confirm_mid1()}
          <span className="font-medium text-ink">{m.data_import_confirm_replaces()}</span>
          {m.data_import_confirm_mid2()}
          {summarize(pending.data)}
          {outro}
        </>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function useExportAction() {
  const data = useScopedData();
  const setNotice = useStore((state) => state.setNotice);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const role = useRole();
  const serverMode = isServerConfigured();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const exportData = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      let exported = data;
      if (serverMode) {
        if (!activeAccountId) throw new Error("Choose a company before exporting.");
        if (role === null || can(role, "purge")) exported = await fetchInactiveSlice(activeAccountId);
      }
      downloadTextFile("capacitylens-data.json", serializeData(exported));
    } catch (error) {
      // Report the export failure instead of suggesting that an incomplete or unavailable backup was saved.
      if (error instanceof InactiveSliceHttpError) {
        setNotice(error.serverMessage ?? m.data_export_failed({ status: error.status }), "error");
      } else if (error instanceof InactiveSliceShapeError) {
        setNotice(m.data_export_incomplete(), "error");
      } else {
        setNotice(m.data_export_error({ error: resolveErrorMessage(error) }), "error");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { busy, exportData };
}

function usePendingImport(
  activeAccountId: string | null,
  setNotice: ReturnType<typeof useStore.getState>["setNotice"],
) {
  const [pending, setPending] = useState<PendingImport | null>(null);
  const selectionRef = useRef(0);
  const accountRef = useRef(activeAccountId);

  useEffect(() => {
    if (accountRef.current === activeAccountId) return;
    accountRef.current = activeAccountId;
    selectionRef.current += 1;
    setPending(null);
  }, [activeAccountId]);

  const readFile = async (file: File) => {
    const selection = ++selectionRef.current;
    try {
      const content = await file.text();
      const parsed = parseData(content);
      if (selection !== selectionRef.current || useStore.getState().activeAccountId !== activeAccountId) return;
      setPending({ accountId: activeAccountId, data: parsed, name: file.name });
    } catch (error) {
      // Only the latest file selection may report a parse failure, or a stale read could overwrite a newer import choice.
      if (selection !== selectionRef.current) return;
      setNotice(resolveErrorMessage(error) || m.data_err_invalid_json({ app: APP_NAME }), "error");
    }
  };

  return { pending, readFile, selectionRef, setPending };
}

function confirmLocalImport(
  incoming: AppData,
  importData: ReturnType<typeof useStore.getState>["importData"],
  setNotice: ReturnType<typeof useStore.getState>["setNotice"],
): void {
  let imported: number;
  let skipped: number;
  try {
    ({ imported, skipped } = importData(incoming));
  } catch (error) {
    // Surface failed local import and stop before suggesting a successful replacement.
    setNotice(resolveErrorMessage(error) || m.data_import_failed({ status: 0 }), "error");
    return;
  }
  if (imported === 0) {
    setNotice(m.data_no_records({ why: buildSkippedMessage(skipped, "why") }), "error");
    return;
  }
  setNotice(buildImportedMessage(imported, skipped));
}

function DataToolControls({
  canImport,
  disabled,
  exportBusy,
  onExport,
  onFile,
}: {
  canImport: boolean;
  disabled: boolean;
  exportBusy: boolean;
  onExport: () => void;
  onFile: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          data-testid="export-data"
          onClick={onExport}
          disabled={disabled || exportBusy}
        >
          {m.data_export()}
        </Button>
        {canImport && (
          <Button
            size="sm"
            variant="outline"
            data-testid="import-data"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
          >
            {m.data_import()}
          </Button>
        )}
      </div>
      {canImport && (
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          data-testid="import-input"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
      )}
    </>
  );
}

/** Offers scoped data export and guarded import for the active account. */
export function ImportExport() {
  // Exports exclude the account row because import preserves the destination company settings. Demo exports include the full local slice; privileged server exports fetch inactive rows, while other roles export their visible active slice.
  const importData = useStore((state) => state.importData);
  const setNotice = useStore((state) => state.setNotice);
  const role = useRole();
  const serverMode = isServerConfigured();
  const activeAccountId = useStore((state) => state.activeAccountId);
  // Import is owner-only in server mode, mirroring the server's own POST /api/import gate: a slice
  // replacement is destructive and id-remapping bypasses field-level write pins. In particular, an
  // admin's valid redacted export has no private codeName/real-name fields and must never be accepted
  // as a replacement that destroys those owner-confidential identities.
  // `role === null` stays importable. That is the off/demo/no-provider regression guard
  // (see permissionContext.ts); the server 403 remains the authoritative backstop either way.
  const canImport = !serverMode || role === null || canSeePrivateNames(role);
  // A full-slice replacement needs explicit confirmation. Demo imports can be undone; server imports replace the authoritative slice without local undo.
  const {
    pending: pendingImport,
    readFile,
    selectionRef,
    setPending: setPendingImport,
  } = usePendingImport(activeAccountId, setNotice);
  const { confirm: confirmServerImport, busy: importBusy, requiresReload: importRequiresReload } = useServerImport();
  const { busy: exportBusy, exportData } = useExportAction();

  const confirmImport = () => {
    if (!pendingImport) return;
    if (pendingImport.accountId !== useStore.getState().activeAccountId) {
      selectionRef.current += 1;
      setPendingImport(null);
      return;
    }
    if (serverMode) {
      const incoming = pendingImport.data;
      setPendingImport(null);
      void confirmServerImport(incoming);
      return;
    }
    const incoming = pendingImport.data;
    setPendingImport(null);
    confirmLocalImport(incoming, importData, setNotice);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="settings-data-tools">
      <DataToolControls
        canImport={canImport}
        disabled={importBusy}
        exportBusy={exportBusy}
        onExport={() => void exportData()}
        onFile={(file) => void readFile(file)}
      />

      {/* The progress dialog stays open until the import and authoritative reload settle. Its no-op dismissal handler prevents Escape or backdrop interaction from exposing a stale slice. */}
      {importBusy && <ImportProgress requiresReload={importRequiresReload} />}

      {pendingImport && canImport && (
        <ImportConfirmation
          pending={pendingImport}
          serverMode={serverMode}
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}
    </div>
  );
}
