import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MasqueradeBootstrapStatus } from './masqueradeApi';
import { renderFreshProvider, makeMeResponse } from './AuthProviderTestKit';

const authBootstrapMocks = vi.hoisted(() => ({
  masqueradeStatus: vi.fn<() => Promise<MasqueradeBootstrapStatus>>(async () => ({
    active: false,
    masqueradeToken: 'idle',
  })),
}));
vi.mock('./masqueradeApi', () => ({
  masqueradeApi: { status: authBootstrapMocks.masqueradeStatus },
}));

afterEach(() => {
  authBootstrapMocks.masqueradeStatus
    .mockReset()
    .mockResolvedValue({ active: false, masqueradeToken: 'idle' });
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('gates company hydration behind authenticated company setup and opens scheduling after confirmation', async () => {
  let created = false;
  const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => {
    if (options?.method === 'POST') {
      created = true;
      return makeMeResponse(201, { companyId: 'wayne' });
    }
    return makeMeResponse(200, {
      user: { id: 'bruce', email: 'bruce@wayne.example', name: 'Bruce Wayne' },
      companySetupRequired: !created,
    });
  });
  vi.stubGlobal('fetch', fetch);
  const { AuthProvider } = await renderFreshProvider();
  const ready = vi.fn();
  render(
    <AuthProvider onCompanyAccessReady={ready}>
      <div>schedule-ready</div>
    </AuthProvider>,
  );
  await screen.findByRole('heading', { name: 'Set up your company' });
  expect(ready).not.toHaveBeenCalled();
  expect(screen.queryByText('schedule-ready')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Company name'), {
    target: { value: 'Wayne Enterprises' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create company' }));
  await screen.findByText('schedule-ready');
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
});

it('adopts a same-user company created in another browser only after confirming Owner access', async () => {
  let createdElsewhere = false;
  const fetch = vi.fn(async (url: unknown, options?: RequestInit) => {
    if (options?.method === 'POST') {
      createdElsewhere = true;
      return makeMeResponse(409, {
        error: 'First company setup is unavailable for this installation.',
      });
    }
    if (String(url).endsWith('/api/companies')) {
      return makeMeResponse(200, [{ id: 'wayne', role: 'owner' }]);
    }
    return makeMeResponse(200, {
      user: { id: 'bruce', email: 'bruce@wayne.example' },
      companySetupRequired: !createdElsewhere,
    });
  });
  vi.stubGlobal('fetch', fetch);
  const { AuthProvider } = await renderFreshProvider();
  const ready = vi.fn();
  render(
    <AuthProvider onCompanyAccessReady={ready}>
      <div>schedule-ready</div>
    </AuthProvider>,
  );
  await screen.findByRole('heading', { name: 'Set up your company' });
  fireEvent.change(screen.getByLabelText('Company name'), {
    target: { value: 'Wayne Enterprises' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create company' }));
  await screen.findByText('schedule-ready');
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it('keeps a conflicting setup refusal visible when the user has no company access', async () => {
  const fetch = vi.fn(async (url: unknown, options?: RequestInit) => {
    if (options?.method === 'POST') {
      return makeMeResponse(409, {
        error: 'First company setup is unavailable for this installation.',
      });
    }
    if (String(url).endsWith('/api/companies')) return makeMeResponse(200, []);
    return makeMeResponse(200, {
      user: { id: 'bruce', email: 'bruce@wayne.example' },
      companySetupRequired: true,
    });
  });
  vi.stubGlobal('fetch', fetch);
  const { AuthProvider } = await renderFreshProvider();
  const ready = vi.fn();
  render(
    <AuthProvider onCompanyAccessReady={ready}>
      <div>schedule-ready</div>
    </AuthProvider>,
  );
  await screen.findByRole('heading', { name: 'Set up your company' });
  fireEvent.change(screen.getByLabelText('Company name'), {
    target: { value: 'Wayne Enterprises' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create company' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('First company setup is unavailable');
  expect(ready).not.toHaveBeenCalled();
  expect(screen.queryByText('schedule-ready')).not.toBeInTheDocument();
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});
