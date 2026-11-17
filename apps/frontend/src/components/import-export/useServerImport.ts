import { useEffect, useRef, useState } from 'react';
import type { BetaExportDocument } from '@capacitylens/shared/data/betaTransfer';
import { companyDataRequests, readImportSummary } from '@/data/companyDataRequests';
import type { ApplyTransferInput, ImportSummary } from '@/data/companyDataRequests';
import { runSuspendedReplacement } from '@/store/suspendedReplacement';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { useStore } from '@/store/useStore';
import type { SetNotice } from '@/store/types';
import { m } from '@/i18n';
import { buildSkippedMessage } from './importExportMessages';

type ImportReport = { setNotice: SetNotice; markReloadRequired: (message: string) => void };
// `errorRaised` means the fresh read set its own error notice, which the success must not replace.
type ImportRecovery = { reloadRequired: boolean; errorRaised: boolean };

const reportCommittedImport = (
  summary: ImportSummary,
  { reloadRequired, errorRaised }: ImportRecovery,
  { setNotice, markReloadRequired }: ImportReport,
): void => {
  const { imported, skipped } = summary;
  if (imported === null) {
    console.warn('import: 200 response with an off-spec body; the slice was replaced server-side');
  } else if (summary.unchanged) {
    setNotice(m.data_import_done());
    return;
  } else if (imported === 0) {
    const why = buildSkippedMessage(skipped, 'why');
    setNotice(m.data_no_records({ why }), 'error');
    return;
  }
  if (reloadRequired) {
    markReloadRequired(m.data_import_refresh_failed());
    return;
  }
  if (errorRaised) return;
  const skippedNote = buildSkippedMessage(skipped, 'note');
  setNotice(
    imported === null
      ? m.data_import_done()
      : imported === 1
        ? m.data_imported_server_one({ count: imported, skipped: skippedNote })
        : m.data_imported_server_other({ count: imported, skipped: skippedNote }),
  );
};

const runServerImport = async (input: ApplyTransferInput, report: ImportReport): Promise<void> => {
  const { setNotice, markReloadRequired } = report;
  const noticeBefore = useStore.getState().notice;
  const outcome = await runSuspendedReplacement({
    send: () => companyDataRequests.applyTransfer(input),
    recovery: 'refresh',
    isChanged: async (response) => {
      const summary = await readImportSummary(response.clone());
      return summary.changed;
    },
  });
  switch (outcome.kind) {
    case 'blocked':
      setNotice(m.data_import_blocked_unsynced(), 'error');
      return;
    case 'departed':
      return;
    case 'refused':
      setNotice(outcome.message ?? m.data_import_failed({ status: outcome.status }), 'error');
      return;
    case 'uncertain':
      if (outcome.reloadRequired) markReloadRequired(m.data_import_unknown_reload_required());
      else setNotice(m.data_import_unknown_reloaded(), 'warning');
      return;
    case 'committed': {
      const noticeAfter = useStore.getState().notice;
      const errorRaised = noticeAfter !== noticeBefore && noticeAfter?.tone === 'error';
      const summary = await readImportSummary(outcome.response);
      reportCommittedImport(
        summary,
        { reloadRequired: outcome.reloadRequired, errorRaised },
        report,
      );
      return;
    }
  }
};

/** Owns the atomic server-import transaction, persistence suspension and recovery state. */
export function useServerImport() {
  const setNotice = useStore((state) => state.setNotice);
  const setDirtyFormSource = useStore((state) => state.setDirtyFormSource);
  const [dirtySource] = useState(() => Symbol('import-busy'));
  const [busy, setBusy] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const importInFlightRef = useRef(false);

  useEffect(() => {
    if (!busy) return;
    setDirtyFormSource({ source: dirtySource, dirty: true });
    return () => setDirtyFormSource({ source: dirtySource, dirty: false });
  }, [busy, dirtySource, setDirtyFormSource]);

  const confirm = async (
    document: BetaExportDocument,
    baseRevision: number,
    confirmationId: string,
  ): Promise<void> => {
    if (importInFlightRef.current) return;
    importInFlightRef.current = true;
    const accountId = useStore.getState().activeAccountId;
    if (accountId === null) {
      importInFlightRef.current = false;
      throw new Error('Import requires an active company.');
    }
    setBusy(true);
    setRequiresReload(false);
    // A reload-required import keeps the busy dialog and the in-flight guard until the page reloads.
    const settled = { reloadRequired: false };
    try {
      await runServerImport(
        { accountId, document, baseRevision, confirmationId },
        {
          setNotice,
          markReloadRequired: (message) => {
            settled.reloadRequired = true;
            setRequiresReload(true);
            setNotice(message, 'error');
          },
        },
      );
      if (!settled.reloadRequired) setBusy(false);
    } catch (error) {
      // Report a failed import-start boundary and release busy state so recovery controls remain usable.
      if (useStore.getState().activeAccountId === accountId) {
        setNotice(resolveErrorMessage(error) || m.data_import_failed({ status: 0 }), 'error');
      }
      setBusy(false);
    } finally {
      if (!settled.reloadRequired) importInFlightRef.current = false;
    }
  };

  return { confirm, busy, requiresReload };
}
