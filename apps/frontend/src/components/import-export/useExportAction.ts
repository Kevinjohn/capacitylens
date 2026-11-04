import { useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { buildBetaExport, serializeBetaExport } from '@capacitylens/shared/data/betaTransfer';
import { downloadTextFile } from '@/lib/download';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { isServerConfigured } from '@/data/apiConfig';
import {
  fetchInactiveSlice,
  InactiveSliceHttpError,
  InactiveSliceShapeError,
} from '@/data/fetchInactiveSlice';
import { useRole } from '@/auth/permissionContext';
import { can, canSeePrivateNames } from '@capacitylens/shared/domain/access';
import { m } from '@/i18n';

/** Downloads the active company's export, reporting a failed or incomplete export as an error. */
export function useExportAction() {
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
        if (!activeAccountId) throw new Error('Choose a company before exporting.');
        if (role === null || can(role, 'anonymise')) {
          exported = await fetchInactiveSlice(activeAccountId);
        }
      }
      if (!activeAccountId) throw new Error('Choose a company before exporting.');
      const completeness = role === null || canSeePrivateNames(role) ? 'full' : 'redacted';
      downloadTextFile(
        'capacitylens-data.json',
        serializeBetaExport(
          buildBetaExport(exported, { accountId: activeAccountId, completeness }),
        ),
      );
    } catch (error) {
      // Report the export failure instead of suggesting that an incomplete or unavailable backup was saved.
      if (error instanceof InactiveSliceHttpError) {
        setNotice(error.serverMessage ?? m.data_export_failed({ status: error.status }), 'error');
      } else if (error instanceof InactiveSliceShapeError) {
        setNotice(m.data_export_incomplete(), 'error');
      } else {
        setNotice(m.data_export_error({ error: resolveErrorMessage(error) }), 'error');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { busy, exportData };
}
