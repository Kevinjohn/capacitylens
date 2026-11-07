import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Role } from '@capacitylens/shared/domain/access';
import { PermissionContext } from '@/auth/permissionContext';
import type { PermissionContextValue } from '@/auth/permissionContext';
import { useStore } from '@/store/useStore';
import { resetStoreWithAccount } from '@/test/fixtures';
import { authorityFor } from '@/test/authorityFixture';
import { useExportAction } from './useExportAction';

const exportMocks = vi.hoisted(() => ({
  fetchInactiveSlice: vi.fn(),
  downloadTextFile: vi.fn(),
}));

vi.mock('@/data/fetchInactiveSlice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/fetchInactiveSlice')>()),
  fetchInactiveSlice: exportMocks.fetchInactiveSlice,
}));
vi.mock('@/lib/download', () => ({ downloadTextFile: exportMocks.downloadTextFile }));
// Record only the export options; document validation is covered by the beta transfer tests.
vi.mock('@capacitylens/shared/data/betaTransfer', () => ({
  buildBetaExport: (_data: unknown, options: { completeness: 'full' | 'redacted' }) => options,
  serializeBetaExport: (document: unknown) => JSON.stringify(document),
}));

beforeEach(async () => {
  await resetStoreWithAccount();
  exportMocks.fetchInactiveSlice.mockReset().mockResolvedValue(useStore.getState().data);
  exportMocks.downloadTextFile.mockReset();
});

afterEach(() => vi.restoreAllMocks());

async function exportAs(value: PermissionContextValue) {
  const { result } = renderHook(() => useExportAction(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>
    ),
  });
  await act(() => result.current.exportData());
  const [, text] = exportMocks.downloadTextFile.mock.calls[0] as [string, string];
  return (JSON.parse(text) as { completeness: string }).completeness;
}

const resolved = (role: Role): PermissionContextValue => ({
  role,
  status: 'resolved',
  access: authorityFor(role),
});

describe('useExportAction inactive slice and redaction by role', () => {
  it.each([
    ['owner', true, 'full'],
    ['admin', true, 'redacted'],
    ['editor', false, 'redacted'],
    ['viewer', false, 'redacted'],
  ] as const)('a resolved %s reads inactive=%s and exports %s', async (role, inactive, kind) => {
    expect(await exportAs(resolved(role))).toBe(kind);
    expect(exportMocks.fetchInactiveSlice).toHaveBeenCalledTimes(inactive ? 1 : 0);
  });

  it('exports active rows only while the role is unresolved', async () => {
    await exportAs({ role: 'owner', status: 'pending', access: null });
    expect(exportMocks.fetchInactiveSlice).not.toHaveBeenCalled();
    expect(exportMocks.downloadTextFile).toHaveBeenCalledOnce();
  });
});
