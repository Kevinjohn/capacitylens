import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { resetStoreWithAccount, jsonResponse } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { m } from '@/i18n';
import {
  confirmMemberAction,
  expectNotice,
  waitForMemberRow,
  mockApi,
  ownerAndEditor,
  rawMember,
  renderSection,
  saveRoleVia,
} from './MembersSection.testSupport';

interface RoleFailureCaseInput {
  status: number;
  body: { error: string };
  expected: RegExp;
  reconciles: boolean;
}

const accountTransitionMocks = vi.hoisted(() => ({
  startMasquerade: vi.fn(async () => true),
}));

vi.mock('@/auth/accountTransition', () => ({
  startMasquerade: accountTransitionMocks.startMasquerade,
}));

vi.mock('@/data/apiConfig', () => ({
  API_BASE: 'http://api.test',
}));

beforeEach(async () => {
  accountTransitionMocks.startMasquerade.mockClear();
  await resetStoreWithAccount();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MembersSection — mutation failure reconciliation', () => {
  registerAccountSwitchMutationTests();
  registerLateReconciliationTests();
  registerRoleFailureTests();
  registerStatusFailureTests();
});

function registerAccountSwitchMutationTests(): void {
  it('reports an authoritative reload failure after an unknown non-self mutation', async () => {
    let mutationSent = false;
    vi.stubGlobal(
      'fetch',
      mockApi(ownerAndEditor, {
        'PATCH /members/ed': () => {
          mutationSent = true;
          return jsonResponse({ error: 'Unknown.' }, 503);
        },
        'GET /members': () =>
          mutationSent
            ? jsonResponse({ error: 'Reload failed.' }, 500)
            : jsonResponse({ members: ownerAndEditor.map((member) => rawMember(member)) }),
      }),
    );
    renderSection();

    await saveRoleVia(userEvent.setup(), await waitForMemberRow(/ed@x\.io/), 'Viewer');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Reload the page before retrying/i);
    expect(alert).not.toHaveTextContent(/company access was refreshed/i);
  });

  it('does not publish a role result after the active account switches mid-request', async () => {
    const nextAccountId = 'acc_second';
    vi.stubGlobal(
      'fetch',
      mockApi(ownerAndEditor, {
        'PATCH /members/ed': () => {
          useStore.setState({ activeAccountId: nextAccountId });
          return new Response(null, { status: 204 });
        },
      }),
    );
    renderSection();

    await saveRoleVia(userEvent.setup(), await waitForMemberRow(/ed@x\.io/), 'Viewer');

    await waitFor(() => expect(useStore.getState().activeAccountId).toBe(nextAccountId));
    expect(useStore.getState().notice).toBeNull();
  });
}

function registerLateReconciliationTests(): void {
  it('does not publish an unknown reconcile whose member reread switches accounts', async () => {
    const nextAccountId = 'acc_second';
    let mutationSent = false;
    vi.stubGlobal(
      'fetch',
      mockApi(ownerAndEditor, {
        'PATCH /members/ed': () => {
          mutationSent = true;
          return jsonResponse({}, 503);
        },
        'GET /members': () => {
          if (mutationSent) useStore.setState({ activeAccountId: nextAccountId });
          return jsonResponse({ members: ownerAndEditor.map((member) => rawMember(member)) });
        },
      }),
    );
    renderSection();

    await saveRoleVia(userEvent.setup(), await waitForMemberRow(/ed@x\.io/), 'Viewer');

    await waitFor(() => expect(useStore.getState().activeAccountId).toBe(nextAccountId));
    expect(useStore.getState().notice).toBeNull();
  });
}

function registerRoleFailureTests(): void {
  it.each([
    { status: 503, body: { error: 'Uncertain.' }, expected: /unknown outcome/i, reconciles: true },
    {
      status: 403,
      body: { error: 'Role forbidden.' },
      expected: /Role forbidden\./,
      reconciles: false,
    },
  ])(
    'handles a $status role-change response without claiming success',
    async ({ status, body, expected, reconciles }: RoleFailureCaseInput) => {
      let memberReads = 0;
      vi.stubGlobal(
        'fetch',
        mockApi(ownerAndEditor, {
          'GET /members': () => {
            memberReads += 1;
            return jsonResponse({ members: ownerAndEditor.map((member) => rawMember(member)) });
          },
          'PATCH /members/ed': () => jsonResponse(body, status),
        }),
      );
      renderSection();

      await saveRoleVia(userEvent.setup(), await waitForMemberRow(/ed@x\.io/), 'Viewer');

      if (reconciles) await expectNotice(expected);
      else expect(await screen.findByRole('alert')).toHaveTextContent(expected);
      expect(useStore.getState().notice?.message).not.toBe(m.settings_members_role_updated());
      expect(memberReads).toBe(reconciles ? 2 : 1);
    },
  );
}

function registerStatusFailureTests(): void {
  it('reconciles a 503 status change without claiming success', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi(ownerAndEditor, {
        'PATCH /members/ed/status': () => jsonResponse({ error: 'Uncertain.' }, 503),
      }),
    );
    renderSection();

    await confirmMemberAction({
      user: userEvent.setup(),
      row: await waitForMemberRow(/ed@x\.io/),
      testId: 'member-suspend',
      confirmationName: /suspend/i,
    });

    await expectNotice(/unknown outcome.*reloaded/i);
    expect(useStore.getState().notice?.message).not.toBe(m.settings_members_status_changed());
  });

  it('includes transport detail when a status change throws', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi(ownerAndEditor, {
        'PATCH /members/ed/status': () => Promise.reject(new Error('status connection lost')),
      }),
    );
    renderSection();

    await confirmMemberAction({
      user: userEvent.setup(),
      row: await waitForMemberRow(/ed@x\.io/),
      testId: 'member-suspend',
      confirmationName: /suspend/i,
    });

    await expectNotice(/unknown outcome.*status connection lost.*reloaded/i);
  });
}
