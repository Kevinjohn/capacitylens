import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { parseBetaExport } from '@capacitylens/shared/data/betaTransfer';
import type { BetaExportDocument } from '@capacitylens/shared/data/betaTransfer';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { APP_NAME } from '@capacitylens/shared/brand';
import { m } from '@/i18n';

export type PendingImport = {
  accountId: string | null;
  document: BetaExportDocument;
  name: string;
};

/** Reads the selected export file; only the latest selection for the current company survives. */
export function usePendingImport(
  activeAccountId: string | null,
  setNotice: ReturnType<typeof useStore.getState>['setNotice'],
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
      if (
        selection !== selectionRef.current ||
        useStore.getState().activeAccountId !== activeAccountId
      ) {
        return;
      }
      setPending({ accountId: activeAccountId, document: parsed, name: file.name });
    } catch (error) {
      // Only the latest file selection may report a parse failure, or a stale read could overwrite a newer import choice.
      if (selection !== selectionRef.current) return;
      setNotice(resolveErrorMessage(error) || m.data_err_invalid_json({ app: APP_NAME }), 'error');
    }
  };

  return { pending, readFile, selectionRef, setPending };
}
