import { useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { isServerConfigured } from '@/data/apiConfig';
import { useRole } from '@/auth/permissionContext';
import { ConfirmDialog, Modal } from './common/ui';
import { m } from '@/i18n';
import { Button } from './ui/button';
import { reloadPage } from '@/lib/reloadPage';
import { useServerImport } from './import-export/useServerImport';
import { BetaImportPreview } from './import-export/BetaImportPreview';
import { confirmLocalImport } from './import-export/confirmLocalImport';
import { summarize } from './import-export/importExportMessages';
import { useExportAction } from './import-export/useExportAction';
import { usePendingImport } from './import-export/usePendingImport';
import type { PendingImport } from './import-export/usePendingImport';
import { PasswordConfirmationDialog } from '@/auth/PasswordConfirmationDialog';
import { API_BASE } from '@/data/apiConfig';
import { apiFetch } from '@/data/requestTimeout';
import { readApiError } from '@/lib/readApiError';

function ImportProgress({ requiresReload }: { requiresReload: boolean }) {
  return (
    <Modal title={m.data_importing_title()} onClose={() => {}} guardDirty={false}>
      {requiresReload ? (
        <div className="flex flex-col gap-3">
          <p
            role="alert"
            data-testid="import-reload-required"
            className="text-sm text-muted-foreground"
          >
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
            event.target.value = '';
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
  const canImport = !serverMode || role === 'owner';
  // A full-slice replacement needs explicit confirmation. Scheduler Undo covers bookings only, so no import mode can be undone from the UI.
  const {
    pending: pendingImport,
    readFile,
    selectionRef,
    setPending: setPendingImport,
  } = usePendingImport(activeAccountId, setNotice);
  const {
    confirm: confirmServerImport,
    busy: importBusy,
    requiresReload: importRequiresReload,
  } = useServerImport();
  const { busy: exportBusy, exportData } = useExportAction();
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState(false);
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
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: activeAccountId, document: pendingImport.document }),
      });
      if (!response.ok) {
        throw new Error(
          (await readApiError(response)) ?? m.data_import_failed({ status: response.status }),
        );
      }
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('baseRevision' in result) ||
        !Number.isSafeInteger(result.baseRevision)
      ) {
        throw new Error(m.data_import_failed({ status: 0 }));
      }
      if (!isCurrent()) return;
      const revision = result.baseRevision as number;
      setPreviewRevision(revision);
    } catch (error) {
      if (isCurrent()) setNotice(resolveErrorMessage(error), 'error');
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
      setConfirmingAction(true);
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
          void readFile(file);
        }}
      />

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
              context={{ accountId: activeAccountId ?? '', memberResourceLinks: [] }}
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
            setPreviewRevision(null);
          }}
        />
      )}
      {pendingImport && activeAccountId && previewRevision !== null && confirmingAction && (
        <PasswordConfirmationDialog
          action="import"
          accountId={activeAccountId}
          intent={{ baseRevision: previewRevision, document: pendingImport.document }}
          onConfirmed={(confirmationId) => {
            setConfirmingAction(false);
            setPendingImport(null);
            void confirmServerImport(pendingImport.document, previewRevision, confirmationId);
          }}
          onCancel={() => setConfirmingAction(false)}
        />
      )}
    </div>
  );
}
