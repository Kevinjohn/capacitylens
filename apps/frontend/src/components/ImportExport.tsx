import { useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { useCan } from '@/auth/permissionContext';
import { ConfirmDialog, FormDialog } from './common/ui';
import { m } from '@/i18n';
import { Button } from './ui/button';
import { reloadPage } from '@/lib/reloadPage';
import { useServerImport } from './import-export/useServerImport';
import { ImportPreview } from './import-export/ImportPreview';
import { summarize } from './import-export/importExportMessages';
import { useExportAction } from './import-export/useExportAction';
import { usePendingImport } from './import-export/usePendingImport';
import type { PendingImport } from './import-export/usePendingImport';
import { PasswordConfirmationDialog } from '@/auth/PasswordConfirmationDialog';
import { companyDataRequests } from '@/data/companyDataRequests';
import type { TransferPreview } from '@/data/companyDataRequests';

function ImportProgress({ requiresReload }: { requiresReload: boolean }) {
  return (
    <FormDialog title={m.data_importing_title()} onClose={() => {}} warnOnDirty={false}>
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
    </FormDialog>
  );
}

function ImportConfirmation({
  pending,
  counts,
  onConfirm,
  onCancel,
}: {
  pending: PendingImport;
  counts: TransferPreview['counts'];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const outro = m.data_import_confirm_outro_server();
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
          {summarize(counts)}
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
  const activeCompanyId = useStore((state) => state.activeCompanyId);
  const canImport = useCan('company:import');
  // A full-set replacement needs explicit confirmation. Scheduler Undo covers bookings only, so no import mode can be undone from the UI.
  const {
    pending: pendingImport,
    readFile,
    selectionRef,
    setPending: setPendingImport,
  } = usePendingImport(activeCompanyId, setNotice);
  const {
    confirm: confirmServerImport,
    busy: importBusy,
    requiresReload: importRequiresReload,
  } = useServerImport();
  const { busy: exportBusy, exportData } = useExportAction();
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [continued, setContinued] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const clearPendingImport = () => {
    setPendingImport(null);
    setPreview(null);
    setPreviewError(null);
  };
  // The server is the only validator: its reply is either the preview or the refusal shown in the dialog.
  const requestPreview = async (pending: PendingImport) => {
    const companyId = pending.companyId;
    if (!companyId) return;
    const selection = selectionRef.current;
    const isCurrent = () =>
      selectionRef.current === selection && useStore.getState().activeCompanyId === companyId;
    try {
      const reply = await companyDataRequests.readTransferPreview(companyId, pending.document);
      if (isCurrent()) setPreview(reply);
    } catch (error) {
      if (isCurrent()) setPreviewError(resolveErrorMessage(error));
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    if (pendingImport.companyId !== useStore.getState().activeCompanyId) {
      selectionRef.current += 1;
      clearPendingImport();
      return;
    }
    setConfirmingAction(true);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="settings-data-tools">
      <DataToolControls
        canImport={canImport}
        disabled={importBusy}
        exportBusy={exportBusy}
        onExport={() => void exportData()}
        onFile={(file) => {
          setContinued(false);
          setPreview(null);
          setPreviewError(null);
          void readFile(file).then((pending) => {
            if (pending) void requestPreview(pending);
          });
        }}
      />

      {/* The progress dialog stays open until the import and authoritative reload settle. Its no-op dismissal handler prevents Escape or backdrop interaction from exposing a stale set. */}
      {importBusy && <ImportProgress requiresReload={importRequiresReload} />}

      {pendingImport && canImport && !continued && (
        <FormDialog
          title={m.data_import_confirm_title()}
          onClose={() => {
            selectionRef.current += 1;
            clearPendingImport();
          }}
          warnOnDirty={false}
        >
          <ImportPreview
            preview={preview}
            error={previewError}
            onContinue={() => preview && setContinued(true)}
          />
        </FormDialog>
      )}
      {pendingImport && canImport && preview && continued && !confirmingAction && (
        <ImportConfirmation
          pending={pendingImport}
          counts={preview.counts}
          onConfirm={confirmImport}
          onCancel={() => {
            selectionRef.current += 1;
            clearPendingImport();
            setContinued(false);
          }}
        />
      )}
      {pendingImport && activeCompanyId && preview && continued && confirmingAction && (
        <PasswordConfirmationDialog
          action="import"
          companyId={activeCompanyId}
          intent={{ baseRevision: preview.baseRevision, document: pendingImport.document }}
          onConfirmed={(confirmationId) => {
            setConfirmingAction(false);
            clearPendingImport();
            void confirmServerImport(pendingImport.document, preview.baseRevision, confirmationId);
          }}
          onCancel={() => setConfirmingAction(false)}
        />
      )}
    </div>
  );
}
