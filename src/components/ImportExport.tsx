import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import { useScopedData } from "../store/useScopedData";
import { parseData, serializeData } from "@capacitylens/shared/data/transfer";
import { downloadTextFile } from "../lib/download";
import { resolveErrorMessage } from "../lib/errorMessage";
import { isServerConfigured } from "../data/apiConfig";
import { fetchInactiveSlice, InactiveSliceHttpError, InactiveSliceShapeError } from "../data/fetchInactiveSlice";
import { useRole } from "../auth/permissionContext";
import { can, canSeePrivateNames } from "@capacitylens/shared/domain/access";
import { ConfirmDialog, Modal } from "./common/ui";
import { m } from "@/i18n";
import { buildUndoShortcut } from "../lib/keyboardShortcuts";
import type { AppData } from "@capacitylens/shared/types/entities";
import { APP_NAME } from "@capacitylens/shared/brand";
import { Button } from "./ui/button";
import { reloadPage } from "../lib/reloadPage";
import { useServerImport } from "./import-export/useServerImport";

// Refuse files past this size before reading them into memory (self-DoS guard).
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

// Order + labels for the "what's in this file" import summary. Each `label` is a render-time
// GETTER (`() => m.key()`), not a pre-resolved string (the nav LINKS / option-getter pattern,
// P1.5.2): this list is module-scope, so resolving `m.key()` here would freeze the label to the
// load-time locale. The getter defers it to render — summarize() calls each at its call site.
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
    if (file.size > MAX_IMPORT_BYTES) {
      setNotice(m.data_err_too_large({ max: MAX_IMPORT_BYTES / (1024 * 1024) }), "error");
      return;
    }
    try {
      const parsed = parseData(await file.text());
      if (selection !== selectionRef.current || useStore.getState().activeAccountId !== activeAccountId) return;
      setPending({ accountId: activeAccountId, data: parsed, name: file.name });
    } catch (error) {
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

export function ImportExport() {
  // Export only the active account's planning data. The `accounts` list itself is deliberately
  // omitted: import re-stamps records into whichever account is active and preserves that
  // destination's identity, calendar, language, scheduling and visibility settings.
  // DELIBERATELY the RAW useScopedData, NOT useActiveScopedData (P2.4): the export must NOT apply the
  // view-only active filter — it serializes whatever the store actually holds. In the DEMO build the store
  // is the whole device blob, so archived + soft-deleted rows ARE retained in the backup. In SERVER
  // mode the store is hydrated from the active-only per-account read (readSlice `includeInactive:false`,
  // P2.4), so those rows are not present client-side — they remain in the server DB and belong to the
  // COMPLETE per-tenant export (P2.6) / the P2.5 admin "Archived & deleted" view, not this client-side
  // snapshot. Using the raw hook keeps this export decoupled from the view-hiding rule (and complete in
  // the demo build); the normal VIEWS use the active-only projection, this export does not.
  const importData = useStore((state) => state.importData);
  const setNotice = useStore((state) => state.setNotice);
  const role = useRole();
  const serverMode = isServerConfigured();
  const activeAccountId = useStore((state) => state.activeAccountId);
  // Import is owner-only in server mode, mirroring the server's own POST /api/import gate: a slice
  // REPLACEMENT is destructive and id-remapping bypasses field-level write pins. In particular, an
  // admin's valid redacted export has no private codeName/real-name fields and must never be accepted
  // as a replacement that destroys those owner-confidential identities.
  // `role === null` stays importable — that is the OFF/demo/no-provider regression guard
  // (see permissionContext.ts); the server 403 remains the authoritative backstop either way.
  const canImport = !serverMode || role === null || canSeePrivateNames(role);
  // A parsed-but-not-yet-applied import, awaiting the user's confirmation. Import
  // is a full replace, so we never apply it silently — confirm first, and the
  // apply goes through the undoable history path so ⌘Z restores the old data.
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
    // Lives in a Settings card (issue #169), NOT the sidebar: a full-slice export/replace is a
    // once-in-a-while administrative act, and it was crowding the day-to-day destinations. The
    // enclosing SettingsSection owns the heading, help and disclosure, so this renders controls only.
    <div className="flex flex-col gap-3" data-testid="settings-data-tools">
      <DataToolControls
        canImport={canImport}
        disabled={importBusy}
        exportBusy={exportBusy}
        onExport={() => void exportData()}
        onFile={(file) => void readFile(file)}
      />

      {/* The import UI LOCK (see importBusy above): a non-dismissable blocking dialog for the few
          seconds of POST + re-hydrate. onClose is a deliberate no-op — visibility is owned by
          importBusy alone, so Escape/backdrop cannot dismiss it. The body carries tabIndex={0} so
          the Modal's Tab-trap engages (it no-ops on a panel with zero focusables) and initial
          focus lands on the status text for screen readers. */}
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
