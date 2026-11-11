import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionContext } from '@/auth/permissionContext';
import {
  DEFAULT_ACCOUNT_ID,
  makeAppData,
  makeResource,
  resetStoreWithAccount,
} from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { ArchivedEntitySection } from './ArchivedEntitySection';

beforeEach(async () => {
  vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1');
  await resetStoreWithAccount();
  const resource = makeResource({
    id: 'resource-archive',
    accountId: DEFAULT_ACCOUNT_ID,
    name: 'Diana Prince',
    role: 'Designer',
    avatarUrl: 'https://images.example/diana.png',
    archivedAt: '2026-01-01T00:00:00.000Z',
  });
  useStore.getState().replaceAll(makeAppData({ resources: [resource] }));
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
});
afterEach(() => vi.unstubAllEnvs());

describe('archived resource actions', () => {
  it('confirms and applies resource anonymisation in the volatile demo', async () => {
    const user = userEvent.setup();
    render(
      <PermissionContext.Provider value={{ role: 'owner', status: 'resolved' }}>
        <ArchivedEntitySection entity="resources" />
      </PermissionContext.Provider>,
    );
    await user.click(screen.getByRole('button', { name: 'Anonymise Diana Prince' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('This cannot be undone.');
    await user.click(within(dialog).getByRole('button', { name: 'Anonymise' }));
    expect(useStore.getState().data.resources[0]?.name).not.toContain('Diana');
    expect(useStore.getState().data.resources[0]?.avatarUrl).toBeNull();
  });

  it('lets an Editor recover an identity without inactive details or anonymisation', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PermissionContext.Provider value={{ role: 'editor', status: 'resolved' }}>
          <ArchivedEntitySection entity="resources" />
        </PermissionContext.Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Restore Diana Prince' })).toBeInTheDocument();
    expect(screen.queryByText('Designer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anonymise/ })).not.toBeInTheDocument();
  });
  it('restores an Editor identity through the existing volatile typed command', async () => {
    await useStore.getState().refreshPlanning();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PermissionContext.Provider value={{ role: 'editor', status: 'resolved' }}>
          <ArchivedEntitySection entity="resources" />
        </PermissionContext.Provider>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Restore Diana Prince' }));
    await waitFor(() =>
      expect(screen.queryByTestId('archived-resources-section')).not.toBeInTheDocument(),
    );
    expect(useStore.getState().data.resources[0]?.archivedAt).toBeNull();
  });
});
