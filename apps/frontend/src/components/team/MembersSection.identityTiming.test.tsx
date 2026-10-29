import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthProvider';
import { useAuth } from '@/auth/authContext';
import { queryClient } from '@/api/queryClient';
import { AUTH_INVALIDATION_STORAGE_KEY } from '@/auth/signOut';
import { useStore } from '@/store/useStore';
import { resetStoreWithAccount, jsonResponse, requireValue } from '@/test/fixtures';
import { MembersSection } from './MembersSection';
import { mockApi, rawMember } from './MembersSection.testSupport';
vi.mock('@/data/apiConfig', () => ({
  API_BASE: 'http://api.test',
  isServerConfigured: () => true,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Principal() {
  return <span data-testid="principal">{useAuth().user?.id}</span>;
}
let principal: string;
let holdDirectory: Promise<Response> | null;
let heldMutation: Promise<Response> | null;
let directoryReads: number;
let invitationReads: number;
let writes: number;
beforeEach(async () => {
  queryClient.clear();
  await resetStoreWithAccount();
  principal = 'bruce';
  holdDirectory = null;
  heldMutation = null;
  directoryReads = 0;
  invitationReads = 0;
  writes = 0;
  const base = mockApi([], {
    'GET /members': () => {
      directoryReads += 1;
      if (holdDirectory) return holdDirectory;
      return directory();
    },
    'GET /invites': () =>
      jsonResponse({
        invites: [
          {
            id: 1,
            role: 'editor',
            preauthEmail: 'clark@wayne.test',
            expiresAt: '2099-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    'POST /api/invites': () => {
      writes += 1;
      return heldMutation ?? jsonResponse({ emailed: true }, 201);
    },
    'POST /resend': () => {
      writes += 1;
      return heldMutation ?? jsonResponse({ emailed: true });
    },
    'GET /api/auth/me': () =>
      jsonResponse({
        authMode: 'password-only',
        user: { id: principal, email: `${principal}@wayne.test` },
        emailVerified: true,
        membershipRequired: false,
        admission: { admitted: true, requirements: {} },
      }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/invites') && (init?.method ?? 'GET') === 'GET') {
        invitationReads += 1;
      }
      if (String(url).includes('/api/masquerade')) {
        return Promise.resolve(jsonResponse({ active: false, contextToken: 'idle' }));
      }
      return base(url, init);
    }),
  );
});
afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function directory() {
  return jsonResponse({
    members: [
      rawMember({ userId: principal, role: 'owner', isSelf: true }),
      rawMember({ userId: 'clark', role: 'editor', name: 'Clark Kent' }),
    ],
    resourceCandidates: [],
    signInTrackingEnabled: false,
  });
}
function renderMembers() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Principal />
        <MembersSection />
      </AuthProvider>
    </QueryClientProvider>,
  );
}
async function refreshed(nextPrincipal: string) {
  principal = nextPrincipal;
  fireEvent.focus(window);
  await waitFor(() => expect(screen.getByTestId('principal')).toHaveTextContent(nextPrincipal));
}
it.each(['create', 'resend'] as const)(
  'drops old-principal %s feedback and reload effects after a real same-company auth refresh',
  async (action) => {
    renderMembers();
    await screen.findByTestId('invite-open');
    const held = deferred<Response>();
    heldMutation = held.promise;
    try {
      if (action === 'create') {
        fireEvent.click(screen.getByTestId('invite-open'));
        fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
          target: { value: 'selina@wayne.test' },
        });
        fireEvent.click(screen.getByTestId('invite-submit'));
      } else fireEvent.click(screen.getByTestId('invite-resend'));
      await waitFor(() => expect(writes).toBe(1));
      await refreshed('diana');
      await screen.findByTestId('invite-open');
      fireEvent.click(screen.getByTestId('invite-open'));
      fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
        target: { value: 'barbara@wayne.test' },
      });
      const reads = directoryReads;
      const invitesBefore = invitationReads;
      useStore.getState().setNotice('Current principal notice');
      await act(async () =>
        held.resolve(jsonResponse({ emailed: true }, action === 'create' ? 201 : 200)),
      );
      expect(useStore.getState().notice?.message).toBe('Current principal notice');
      expect(screen.getByRole('textbox', { name: /email/i })).toHaveValue('barbara@wayne.test');
      expect(directoryReads).toBe(reads);
      expect(invitationReads).toBe(invitesBefore);
      expect(writes).toBe(1);
    } finally {
      await act(async () => held.resolve(jsonResponse({ emailed: true })));
      heldMutation = null;
    }
  },
);
it.each(
  (['different principal', 'same principal', 'observed sign-out'] as const).flatMap((kind) =>
    (['role', 'confirmation'] as const).map((intent) => ({ kind, intent })),
  ),
)('binds retained $intent intent across $kind refresh', async ({ kind, intent }) => {
  renderMembers();
  const rows = await screen.findAllByTestId('member-row');
  const row = requireValue(
    rows.find((row) => row.textContent.includes('clark@x.io')),
    'Clark member row',
  );
  if (intent === 'role') fireEvent.click(within(row).getByTestId('member-edit'));
  else {
    fireEvent.click(within(row).getByTestId('member-menu'));
    fireEvent.click(await screen.findByTestId('member-remove'));
  }
  const dialogRole = intent === 'role' ? 'dialog' : 'alertdialog';
  expect(await screen.findByRole(dialogRole)).toHaveTextContent('Clark Kent');
  const held = deferred<Response>();
  holdDirectory = held.promise;
  try {
    const accountId = useStore.getState().activeAccountId;
    if (kind === 'observed sign-out') {
      fireEvent(
        window,
        new StorageEvent('storage', { key: AUTH_INVALIDATION_STORAGE_KEY, newValue: 'changed' }),
      );
      await screen.findByTestId('principal');
      await act(async () => {
        await resetStoreWithAccount(accountId ?? undefined);
      });
    } else await refreshed(kind === 'same principal' ? 'bruce' : 'diana');
    holdDirectory = null;
    await act(async () => held.resolve(directory()));
    await screen.findAllByTestId('member-row');
    if (kind === 'same principal') {
      expect(screen.getByRole(dialogRole)).toHaveTextContent('Clark Kent');
    } else expect(screen.queryByRole(dialogRole)).not.toBeInTheDocument();
    expect(writes).toBe(0);
  } finally {
    holdDirectory = null;
    await act(async () => held.resolve(directory()));
  }
});
