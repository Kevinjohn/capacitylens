import { useStore } from '@/store/useStore';
import { prepareBetaImport } from '@capacitylens/shared/data/betaTransfer';
import type { BetaExportDocument } from '@capacitylens/shared/data/betaTransfer';
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { m } from '@/i18n';
import { buildImportedMessage } from './importExportMessages';

/** Replaces the demo company's rows with an imported export, refusing IDs another demo company uses. */
export function confirmLocalImport(
  document: BetaExportDocument,
  accountId: string,
  setNotice: ReturnType<typeof useStore.getState>['setNotice'],
): void {
  try {
    const prepared = prepareBetaImport(document, { accountId, memberResourceLinks: [] });
    const current = useStore.getState().data;
    for (const key of SCOPED_KEYS) {
      const retainedIds = new Set(
        current[key].filter((row) => row.accountId !== accountId).map((row) => row.id),
      );
      if (prepared.data[key].some((row) => retainedIds.has(row.id))) {
        throw new Error('The import contains scheduling IDs used by another demo company.');
      }
    }
    const next = {
      ...current,
      accounts: [
        ...current.accounts.filter((row) => row.id !== accountId),
        ...prepared.data.accounts,
      ],
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
    setNotice(resolveErrorMessage(error) || m.data_import_failed({ status: 0 }), 'error');
  }
}
