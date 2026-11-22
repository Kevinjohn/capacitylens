import { it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useStore } from '@/store/useStore';
import { DEFAULT_COMPANY_ID } from '@/test/fixtures';
import { setUpAppShellTests, renderAppShell, renderAuthenticated } from './AppShellTestKit';
import { masqueradeGrantFor } from '@/test/permissionGrants';

const i18nMocks = vi.hoisted(() => ({ syncLocaleFromCompany: vi.fn() }));
vi.mock('@/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n')>()),
  syncLocaleFromCompany: i18nMocks.syncLocaleFromCompany,
}));

setUpAppShellTests(i18nMocks.syncLocaleFromCompany);

it('shows a fail-closed banner while a member view is starting', () => {
  useStore.getState().setMasquerade({
    kind: 'starting',
    generation: 1,
    pending: { companyId: DEFAULT_COMPANY_ID, targetUserId: 'u-viewer' },
  });

  renderAppShell({});

  const banner = screen.getByTestId('masquerade-banner');
  expect(banner).toHaveTextContent('Starting View as member…');
  expect(within(banner).queryByRole('button')).not.toBeInTheDocument();
});

it('offers projection recovery after the server has prepared a starting member view', () => {
  useStore.getState().setMasquerade({
    kind: 'starting',
    generation: 1,
    pending: { companyId: DEFAULT_COMPANY_ID, targetUserId: 'u-viewer' },
    state: {
      companyId: DEFAULT_COMPANY_ID,
      targetUserId: 'u-viewer',
      targetName: 'Selina Kyle',
      effectiveRole: 'viewer',
      ...masqueradeGrantFor('viewer'),
      startedAt: '2026-09-01T10:00:00.000Z',
      expiresAt: '2999-09-01T10:15:00.000Z',
      token: 'token-1',
    },
  });

  renderAppShell({});

  const banner = screen.getByTestId('masquerade-banner');
  expect(within(banner).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(within(banner).getByRole('button', { name: 'End now' })).toBeInTheDocument();
});

it('hides old actor route data during a member-view projection while keeping recovery controls', () => {
  useStore.getState().setMasquerade({
    kind: 'starting',
    generation: 1,
    pending: { companyId: DEFAULT_COMPANY_ID, targetUserId: 'u-viewer' },
    state: {
      companyId: DEFAULT_COMPANY_ID,
      targetUserId: 'u-viewer',
      targetName: 'Selina Kyle',
      effectiveRole: 'viewer',
      ...masqueradeGrantFor('viewer'),
      startedAt: '2026-09-01T10:00:00.000Z',
      expiresAt: '2999-09-01T10:15:00.000Z',
      token: 'token-1',
    },
  });

  renderAuthenticated(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>old actor private row</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

  expect(screen.getByTestId('masquerade-banner')).toHaveTextContent('Starting View as member…');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'End now' })).toBeInTheDocument();
  expect(screen.queryByText('old actor private row')).not.toBeInTheDocument();
  expect(
    screen.getAllByRole('status').some((element) => element.textContent.includes('Loading')),
  ).toBe(true);
});

it('offers Retry and End when an authenticated cold member view has no selected company', () => {
  useStore.getState().clearPlanning();
  useStore.getState().setMasquerade({
    kind: 'starting',
    generation: 1,
    pending: { companyId: DEFAULT_COMPANY_ID, targetUserId: 'u-viewer' },
    state: {
      companyId: DEFAULT_COMPANY_ID,
      targetUserId: 'u-viewer',
      targetName: 'Selina Kyle',
      effectiveRole: 'viewer',
      ...masqueradeGrantFor('viewer'),
      startedAt: '2026-09-01T10:00:00.000Z',
      expiresAt: '2999-09-01T10:15:00.000Z',
      token: 'token-1',
    },
  });
  renderAppShell();
  const banner = screen.getByTestId('masquerade-banner');
  expect(within(banner).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(within(banner).getByRole('button', { name: 'End now' })).toBeInTheDocument();
});
