import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import { useScopedData } from "../store/useScopedData";
import { parseData, serializeData } from "@capacitylens/shared/data/transfer";
import { downloadTextFile } from "../lib/download";
import { errorMessage } from "../lib/errorMessage";
import { isServerConfigured } from "../data/apiConfig";
import { fetchInactiveSlice, InactiveSliceHttpError, InactiveSliceShapeError } from "../data/fetchInactiveSlice";
import { useRole } from "../auth/permissionContext";
import { can, canSeePrivateNames } from "@capacitylens/shared/domain/access";
import { ConfirmDialog, Modal } from "./common/ui";
import { m } from "@/i18n";
import { undoShortcut } from "../lib/keyboardShortcuts";
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
];

function summarize(data: AppData): string {
  const parts = SUMMARY.filter(([k]) => data[k].length > 0).map(([k, label]) => `${data[k].length} ${label()}`);
  return parts.length ? parts.join(", ") : m.data_summary_none();
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
  const data = useScopedData();
  const importData = useStore((s) => s.importData);
  const setNotice = useStore((s) => s.setNotice);
  const fileRef = useRef<HTMLInputElement>(null);
  // File reads are asynchronous and the hidden input is reset after every selection. Keep a
  // generation so an older, slower read cannot replace the confirmation prepared for the latest
  // file (or surface its stale parse error over that selection).
  const importSelectionRef = useRef(0);
  const role = useRole();
  const serverMode = isServerConfigured();
  const activeAccountId = useStore((s) => s.activeAccountId);
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
  const [pendingImport, setPendingImport] = useState<{
    accountId: string | null;
    data: AppData;
    name: string;
  } | null>(null);
  const importAccountRef = useRef(activeAccountId);
  const { confirm: confirmServerImport, busy: importBusy, requiresReload: importRequiresReload } = useServerImport();
  const [exportBusy, setExportBusy] = useState(false);
  const exportInFlight = useRef(false);

  // A file selection belongs to the company that was active when reading began. Account switching
  // stays available while the browser reads or while the confirmation is open, so invalidate both
  // states at the boundary rather than allowing a whole-slice replacement to follow the new account.
  useEffect(() => {
    if (importAccountRef.current === activeAccountId) return;
    importAccountRef.current = activeAccountId;
    importSelectionRef.current += 1;
    setPendingImport(null);
  }, [activeAccountId]);

  const onExport = async () => {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setExportBusy(true);
    // downloadTextFile throws if the download couldn't start — surface it rather than letting it
    // escape as an uncaught handler error, so the user knows the export did NOT save.
    try {
      let exported = data;
      if (serverMode) {
        if (!activeAccountId) throw new Error("Choose a company before exporting.");
        // Admin/OFF-mode callers receive the structurally validated complete slice. Editors and
        // viewers retain their previously available active, already-redacted store export instead
        // of being sent to the purge-gated endpoint and receiving a guaranteed 403.
        if (role === null || can(role, "purge")) exported = await fetchInactiveSlice(activeAccountId);
      }
      downloadTextFile("capacitylens-data.json", serializeData(exported));
    } catch (e) {
      if (e instanceof InactiveSliceHttpError) {
        setNotice(e.serverMessage ?? m.data_export_failed({ status: e.status }), "error");
      } else if (e instanceof InactiveSliceShapeError) {
        setNotice(m.data_export_incomplete(), "error");
      } else {
        setNotice(m.data_export_error({ error: errorMessage(e) }), "error");
      }
    } finally {
      exportInFlight.current = false;
      setExportBusy(false);
    }
  };

  const onImport = async (file: File) => {
    const selection = ++importSelectionRef.current;
    const selectedAccountId = activeAccountId;
    // Reject an oversized file before reading it into memory (self-DoS guard).
    if (file.size > MAX_IMPORT_BYTES) {
      setNotice(m.data_err_too_large({ max: MAX_IMPORT_BYTES / (1024 * 1024) }), "error");
      return;
    }
    try {
      const parsed = parseData(await file.text());
      if (selection !== importSelectionRef.current || useStore.getState().activeAccountId !== selectedAccountId) return;
      setPendingImport({ accountId: selectedAccountId, data: parsed, name: file.name });
    } catch (e) {
      if (selection !== importSelectionRef.current) return;
      // parseData throws PRECISE, user-ready messages ("This file isn't valid JSON.", "This file is
      // damaged: a data table is not a list.", "This file has too many records (…)", "This file
      // contains no CapacityLens records.") — surface the REAL reason instead of a generic catch-all, so
      // the user (and a contributor) knows why the file was rejected.
      setNotice(errorMessage(e) || m.data_err_invalid_json({ app: APP_NAME }), "error");
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    if (pendingImport.accountId !== useStore.getState().activeAccountId) {
      importSelectionRef.current += 1;
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
    let imported: number;
    let skipped: number;
    try {
      ({ imported, skipped } = importData(incoming));
    } catch (e) {
      setNotice(errorMessage(e) || m.data_import_failed({ status: 0 }), "error");
      return;
    }
    // When EVERY record was dropped (imported === 0) the store no-ops — it pushes NO undo
    // entry — so we must NOT tell the user to press ⌘Z (that would revert their PREVIOUS,
    // unrelated edit). Report the failure instead.
    if (imported === 0) {
      const why =
        skipped > 0
          ? skipped === 1
            ? m.data_why_skipped_one({ count: skipped })
            : m.data_why_skipped_other({ count: skipped })
          : "";
      setNotice(m.data_no_records({ why }), "error");
      return;
    }
    // Report the delta honestly: the store drops allocations/time-off with broken
    // ranges or dangling refs, so "imported 40" can become 31 in the store.
    const skippedNote =
      skipped > 0
        ? skipped === 1
          ? m.data_skipped_note_one({ count: skipped })
          : m.data_skipped_note_other({ count: skipped })
        : "";
    setNotice(
      imported === 1
        ? m.data_imported_one({ count: imported, skipped: skippedNote, shortcut: undoShortcut() })
        : m.data_imported_other({ count: imported, skipped: skippedNote, shortcut: undoShortcut() }),
    );
  };

  return (
    // Lives in a Settings card (issue #169), NOT the sidebar: a full-slice export/replace is a
    // once-in-a-while administrative act, and it was crowding the day-to-day destinations. The
    // enclosing SettingsSection owns the heading, help and disclosure, so this renders controls only.
    <div className="flex flex-col gap-3" data-testid="settings-data-tools">
      <div className="flex flex-wrap gap-2">
        {/* Disabled while a server import is in flight: an export mid-replacement would snapshot a
            slice that is about to be obsolete, and a second import would race the first. */}
        <Button
          size="sm"
          variant="outline"
          data-testid="export-data"
          onClick={() => void onExport()}
          disabled={importBusy || exportBusy}
        >
          {m.data_export()}
        </Button>
        {canImport && (
          <Button
            size="sm"
            variant="outline"
            data-testid="import-data"
            onClick={() => fileRef.current?.click()}
            disabled={importBusy}
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
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = "";
          }}
        />
      )}

      {/* The import UI LOCK (see importBusy above): a non-dismissable blocking dialog for the few
          seconds of POST + re-hydrate. onClose is a deliberate no-op — visibility is owned by
          importBusy alone, so Escape/backdrop cannot dismiss it. The body carries tabIndex={0} so
          the Modal's Tab-trap engages (it no-ops on a panel with zero focusables) and initial
          focus lands on the status text for screen readers. */}
      {importBusy && (
        <Modal title={m.data_importing_title()} onClose={() => {}} guardDirty={false}>
          {importRequiresReload ? (
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
      )}

      {pendingImport && canImport && (
        <ConfirmDialog
          title={m.data_import_confirm_title()}
          confirmLabel={m.data_import_confirm_action()}
          message={
            <>
              {m.data_import_confirm_intro()}
              <span className="font-medium text-ink">{pendingImport.name}</span>
              {m.data_import_confirm_mid1()}
              <span className="font-medium text-ink">{m.data_import_confirm_replaces()}</span>
              {m.data_import_confirm_mid2()}
              {summarize(pendingImport.data)}
              {/* Honest dialog semantics: the demo/local import goes through the undoable store
                  history (⌘Z restores); the server import is an atomic server-side slice replace
                  the store history never sees, so promising ⌘Z there would be a lie. */}
              {serverMode
                ? m.data_import_confirm_outro_server()
                : m.data_import_confirm_outro({ shortcut: undoShortcut() })}
            </>
          }
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}
    </div>
  );
}
