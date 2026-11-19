import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { APP_NAME } from '@capacitylens/shared/brand';
import { m } from '@/i18n';

export type PendingImport = {
  companyId: string | null;
  /** The file's parsed JSON, sent unchanged to preview, password confirmation and apply. */
  document: unknown;
  name: string;
};

/**
 * Reads the selected export file; only the latest selection for the current company survives. The
 * browser checks only that the file is JSON; the server's preview validates the document.
 */
export function usePendingImport(
  activeCompanyId: string | null,
  setNotice: ReturnType<typeof useStore.getState>['setNotice'],
) {
  const [pending, setPending] = useState<PendingImport | null>(null);
  const selectionRef = useRef(0);
  const accountRef = useRef(activeCompanyId);

  useEffect(() => {
    if (accountRef.current === activeCompanyId) return;
    accountRef.current = activeCompanyId;
    selectionRef.current += 1;
    setPending(null);
  }, [activeCompanyId]);

  /** Stores the file as the pending import, or returns null when it is not JSON or was superseded. */
  const readFile = async (file: File): Promise<PendingImport | null> => {
    const selection = ++selectionRef.current;
    setPending(null);
    let document: unknown;
    try {
      document = JSON.parse(await file.text()) as unknown;
    } catch {
      // Only the latest file selection may report a failure, or a stale read could overwrite a newer import choice.
      if (selection === selectionRef.current) {
        setNotice(m.data_err_invalid_json({ app: APP_NAME }), 'error');
      }
      return null;
    }
    if (
      selection !== selectionRef.current ||
      useStore.getState().activeCompanyId !== activeCompanyId
    ) {
      return null;
    }
    const selected = { companyId: activeCompanyId, document, name: file.name };
    setPending(selected);
    return selected;
  };

  return { pending, readFile, selectionRef, setPending };
}
