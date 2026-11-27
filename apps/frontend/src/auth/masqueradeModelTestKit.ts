import { setMasqueradeToken } from '@/api/masqueradeToken'
import { vi } from 'vitest'
import type { MasqueradeState, MasqueradeStatus } from '@capacitylens/shared/domain/masquerade'
import { useStore } from '@/store/useStore'
import { MasqueradeModel } from './masqueradeModel'
import type { MasqueradeModelDependencies } from './masqueradeModel'
import { masqueradeGrantFor } from '@/test/permissionGrants'

export const state: MasqueradeState & { masqueradeToken: string } = {
  companyId: 'a-studio',
  targetUserId: 'u-viewer',
  targetName: 'Selina Kyle',
  effectiveRole: 'viewer',
  ...masqueradeGrantFor('viewer'),
  startedAt: '2026-09-01T10:00:00.000Z',
  expiresAt: '2026-09-01T10:15:00.000Z',
  token: 'token-1',
  masqueradeToken: 'token-1',
}
export const inactiveStatus = { active: false as const, masqueradeToken: 'idle-context' }

export function createHarness(overrides: Partial<MasqueradeModelDependencies> = {}) {
  const resume = vi.fn()
  const dependencies: MasqueradeModelDependencies = {
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
    setMasqueradeToken,
    ...overrides,
  }
  return { model: new MasqueradeModel(dependencies), dependencies, resume }
}
