import { useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { apiRouteUrl } from '@/api/queryClient';
import { apiFetch, API_BULK_TIMEOUT_MS } from '@/data/requestTimeout';
import { downloadTextFile } from '@/lib/download';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { readApiError } from '@/lib/readApiError';
import { m } from '@/i18n';

/** Saves the export document the server builds for the active company, reporting a refusal as an error. */
export function useExportAction() {
  const setNotice = useStore((state) => state.setNotice);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const exportData = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (!activeAccountId) throw new Error('An active company is required before exporting.');
      const response = await apiFetch(
        apiRouteUrl('api.export', { params: { accountId: activeAccountId } }),
        { credentials: 'include' },
        API_BULK_TIMEOUT_MS,
      );
      if (!response.ok) {
        setNotice(
          (await readApiError(response)) ?? m.data_export_failed({ status: response.status }),
          'error',
        );
        return;
      }
      downloadTextFile('capacitylens-data.json', await response.text());
    } catch (error) {
      // Report the export failure instead of suggesting that an unavailable backup was saved.
      setNotice(m.data_export_error({ error: resolveErrorMessage(error) }), 'error');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { busy, exportData };
}
