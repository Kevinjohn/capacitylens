import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import {
  buildBetaExport,
  parseBetaExport,
  prepareBetaImport,
  serializeBetaExport,
} from "@capacitylens/shared/data/betaTransfer";
import type { BetaExportDocument } from "@capacitylens/shared/data/betaTransfer";
import { downloadTextFile } from "@/lib/download";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { isServerConfigured } from "@/data/apiConfig";
import { fetchInactiveSlice, InactiveSliceHttpError, InactiveSliceShapeError } from "@/data/fetchInactiveSlice";
import { useRole } from "@/auth/permissionContext";
import { can, canSeePrivateNames } from "@capacitylens/shared/domain/access";
import { ConfirmDialog, Modal } from "./common/ui";
import { m } from "@/i18n";
import type { AppData } from "@capacitylens/shared/types/entities";
import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import { APP_NAME } from "@capacitylens/shared/brand";
import { Button } from "./ui/button";
import { reloadPage } from "@/lib/reloadPage";
import { useServerImport } from "./import-export/useServerImport";
import { BetaImportPreview } from "./import-export/BetaImportPreview";
import { ActionProofDialog } from "@/auth/ActionProofDialog";
import { API_BASE } from "@/data/apiConfig";
import { apiFetch } from "@/data/requestTimeout";
import { readApiError } from "@/lib/readApiError";

const PENDING_PROOF_KEY = "capacitylens/import-action-proof";

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

type PendingImport = { accountId: string | null; document: BetaExportDocument; name: string };

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
  const values = { count: imported, skipped: buildSkippedMessage(skipped, "note") };
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
  const outro = serverMode ? m.data_import_confirm_outro_server() : m.data_import_confirm_outro();
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
          {summarize(pending.document.data)}
          {outro}
        </>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function useExportAction() {
  const data = useStore((state) => state.data);
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
      if (!activeAccountId) throw new Error("Choose a company before exporting.");
      const completeness = role === null || canSeePrivateNames(role) ? "full" : "redacted";
      downloadTextFile(
        "capacitylens-data.json",
        serializeBetaExport(buildBetaExport(exported, { accountId: activeAccountId, completeness })),
      );
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
    setPending(null);
    try {
      const content = await file.text();
      const parsed = parseBetaExport(content);
      if (selection !== selectionRef.current || useStore.getState().activeAccountId !== activeAccountId) return;
      setPending({ accountId: activeAccountId, document: parsed, name: file.name });
    } catch (error) {
      // Only the latest file selection may report a parse failure, or a stale read could overwrite a newer import choice.
      if (selection !== selectionRef.current) return;
      setNotice(resolveErrorMessage(error) || m.data_err_invalid_json({ app: APP_NAME }), "error");
    }
  };

  return { pending, readFile, selectionRef, setPending };
}

function confirmLocalImport(
  document: BetaExportDocument,
  accountId: string,
  setNotice: ReturnType<typeof useStore.getState>["setNotice"],
): void {
  try {
    const prepared = prepareBetaImport(document, { accountId, memberResourceLinks: [] });
    const current = useStore.getState().data;
    const next = {
      ...current,
      accounts: [...current.accounts.filter((row) => row.id !== accountId), ...prepared.data.accounts],
    };
    for (const key of SCOPED_KEYS) {
      (next as unknown as Record<string, unknown>)[key] = [
        ...current[key].filter((row) => row.accountId !== accountId),
        ...prepared.data[key],
      ];
    }
    useStore.getState().replaceAfterDemoImport(next);
    setNotice(buildImportedMessage(prepared.imported, 0));
  } catch (error) {
    setNotice(resolveErrorMessage(error) || m.data_import_failed({ status: 0 }), "error");
  }
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
  const setNotice = useStore((state) => state.setNotice);
  const role = useRole();
  const serverMode = isServerConfigured();
  const activeAccountId = useStore((state) => state.activeAccountId);
  const canImport = !serverMode || role === "owner";
  // A full-slice replacement needs explicit confirmation. Scheduler Undo covers bookings only, so no import mode can be undone from the UI.
  const {
    pending: pendingImport,
    readFile,
    selectionRef,
    setPending: setPendingImport,
  } = usePendingImport(activeAccountId, setNotice);
  const { confirm: confirmServerImport, busy: importBusy, requiresReload: importRequiresReload } = useServerImport();
  const { busy: exportBusy, exportData } = useExportAction();
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const [readyProof, setReadyProof] = useState<string | null>(null);
  const [returnedProof, setReturnedProof] = useState<{ id: string; baseRevision: number } | null>(null);
  const proofAccountRef = useRef(activeAccountId);

  useEffect(() => {
    const saved = sessionStorage.getItem(PENDING_PROOF_KEY);
    if (new URLSearchParams(window.location.search).get("capacitylensActionConfirmed") !== "1") {
      if (saved) sessionStorage.removeItem(PENDING_PROOF_KEY);
      return;
    }
    if (!activeAccountId) return;
    if (!saved) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(PENDING_PROOF_KEY);
      const url = new URL(window.location.href);
      url.searchParams.delete("capacitylensActionConfirmed");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      try {
        const value: unknown = JSON.parse(saved);
        if (
          !value ||
          typeof value !== "object" ||
          !("accountId" in value) ||
          value.accountId !== activeAccountId ||
          !("baseRevision" in value) ||
          !Number.isSafeInteger(value.baseRevision) ||
          !("proofId" in value) ||
          typeof value.proofId !== "string"
        )
          throw new Error("Import confirmation could not be resumed.");
        setReturnedProof({ id: value.proofId, baseRevision: value.baseRevision as number });
      } catch {
        setNotice(m.data_import_failed({ status: 0 }), "error");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeAccountId, setNotice]);

  useEffect(() => {
    if (proofAccountRef.current === activeAccountId) return;
    proofAccountRef.current = activeAccountId;
    setReturnedProof(null);
    setReadyProof(null);
  }, [activeAccountId]);

  const continuePreview = async () => {
    if (!pendingImport || !activeAccountId) return;
    if (!serverMode) {
      setPreviewRevision(0);
      return;
    }
    const selection = selectionRef.current;
    const isCurrent = () =>
      selectionRef.current === selection && useStore.getState().activeAccountId === activeAccountId;
    setPreviewBusy(true);
    try {
      const response = await apiFetch(`${API_BASE}/api/transfer/preview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, document: pendingImport.document }),
      });
      if (!response.ok)
        throw new Error((await readApiError(response)) ?? m.data_import_failed({ status: response.status }));
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        !("baseRevision" in result) ||
        !Number.isSafeInteger(result.baseRevision)
      )
        throw new Error(m.data_import_failed({ status: 0 }));
      if (!isCurrent()) return;
      const revision = result.baseRevision as number;
      if (returnedProof && returnedProof.baseRevision !== revision) {
        setReturnedProof(null);
        throw new Error("The company changed. Preview the current data again and confirm a new import.");
      }
      setPreviewRevision(revision);
      if (returnedProof) {
        setReadyProof(returnedProof.id);
        setReturnedProof(null);
      }
    } catch (error) {
      if (isCurrent()) setNotice(resolveErrorMessage(error), "error");
    } finally {
      if (isCurrent()) setPreviewBusy(false);
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    if (pendingImport.accountId !== useStore.getState().activeAccountId) {
      selectionRef.current += 1;
      setPendingImport(null);
      return;
    }
    if (serverMode) {
      if (readyProof && previewRevision !== null) {
        const proofId = readyProof;
        setReadyProof(null);
        setPendingImport(null);
        void confirmServerImport(pendingImport.document, previewRevision, proofId);
      } else setConfirmingAction(true);
      return;
    }
    if (!activeAccountId) return;
    setPendingImport(null);
    confirmLocalImport(pendingImport.document, activeAccountId, setNotice);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="settings-data-tools">
      <DataToolControls
        canImport={canImport}
        disabled={importBusy}
        exportBusy={exportBusy}
        onExport={() => void exportData()}
        onFile={(file) => {
          setPreviewRevision(null);
          setPreviewBusy(false);
          if (!returnedProof) setReadyProof(null);
          void readFile(file);
        }}
      />

      {returnedProof && <p role="status">{m.data_import_reselect_after_google()}</p>}

      {/* The progress dialog stays open until the import and authoritative reload settle. Its no-op dismissal handler prevents Escape or backdrop interaction from exposing a stale slice. */}
      {importBusy && <ImportProgress requiresReload={importRequiresReload} />}

      {pendingImport && canImport && previewRevision === null && (
        <Modal
          title={m.data_import_confirm_title()}
          onClose={() => {
            selectionRef.current += 1;
            setPendingImport(null);
            setPreviewBusy(false);
          }}
          guardDirty={false}
        >
          {previewBusy ? (
            <p role="status">{m.data_importing_body()}</p>
          ) : (
            <BetaImportPreview
              document={pendingImport.document}
              context={{ accountId: activeAccountId ?? "", memberResourceLinks: [] }}
              onPrepared={() => void continuePreview()}
            />
          )}
        </Modal>
      )}
      {pendingImport && canImport && previewRevision !== null && !confirmingAction && (
        <ImportConfirmation
          pending={pendingImport}
          serverMode={serverMode}
          onConfirm={confirmImport}
          onCancel={() => {
            selectionRef.current += 1;
            setPendingImport(null);
            setReadyProof(null);
            setPreviewRevision(null);
          }}
        />
      )}
      {pendingImport && activeAccountId && previewRevision !== null && confirmingAction && (
        <ActionProofDialog
          action="import"
          accountId={activeAccountId}
          intent={{ baseRevision: previewRevision, document: pendingImport.document }}
          onConfirmed={(proofId) => {
            setConfirmingAction(false);
            setPendingImport(null);
            void confirmServerImport(pendingImport.document, previewRevision, proofId);
          }}
          onProviderStart={(proofId) =>
            sessionStorage.setItem(
              PENDING_PROOF_KEY,
              JSON.stringify({
                accountId: activeAccountId,
                baseRevision: previewRevision,
                proofId,
              }),
            )
          }
          onCancel={() => setConfirmingAction(false)}
        />
      )}
    </div>
  );
}
