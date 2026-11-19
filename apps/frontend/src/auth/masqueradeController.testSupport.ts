import { setMasqueradeContextToken } from '@/api/masqueradeContext';
import { vi } from 'vitest';
import type { MasqueradeState, MasqueradeStatus } from '@capacitylens/shared/domain/masquerade';
import { useStore } from '@/store/useStore';
import { MasqueradeController } from './masqueradeController';
import type { MasqueradeControllerDependencies } from './masqueradeController';
import { viewAsGrantFor } from '@/test/permissionGrants';

export const state: MasqueradeState & { contextToken: string } = {
  companyId: 'a-studio',
  targetUserId: 'u-viewer',
  targetName: 'Selina Kyle',
  effectiveRole: 'viewer',
  ...viewAsGrantFor('viewer'),
  startedAt: '2026-09-01T10:00:00.000Z',
  expiresAt: '2026-09-01T10:15:00.000Z',
  token: 'token-1',
  contextToken: 'token-1',
};
export const inactiveStatus = { active: false as const, contextToken: 'idle-context' };

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function harness(overrides: Partial<MasqueradeControllerDependencies> = {}) {
  const resume = vi.fn();
  const dependencies: MasqueradeControllerDependencies = {
    flush: vi.fn(async () => ({ kind: 'clean' as const })),
    suspend: vi.fn(() => resume),
    reproject: vi.fn(async () => true),
    switchCompany: vi.fn(async () => ({ kind: 'reloaded' as const })),
    readBootstrapCompany: vi.fn(async () => 'Wayne Enterprises'),
    api: {
      status: vi.fn(async (): Promise<MasqueradeStatus> => inactiveStatus),
      start: vi.fn(async () => state),
      end: vi.fn(async () => {}),
    },
    readState: () => useStore.getState(),
    setContextToken: setMasqueradeContextToken,
    ...overrides,
  };
  return { controller: new MasqueradeController(dependencies), dependencies, resume };
}
