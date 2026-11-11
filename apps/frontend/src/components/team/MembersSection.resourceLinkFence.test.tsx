import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { m } from '@/i18n';
import { teamAccessClient } from '@/account/teamAccessClient';
import type { TeamDirectory, TeamMember } from '@/account/teamAccessClient';
import { resetStoreWithAccount } from '@/test/fixtures';
import { mockApi, renderSection, waitForMemberRow } from './MembersSection.testSupport';
import type { User } from './MembersSection.testSupport';

vi.mock('@/data/apiConfig', () => ({
  API_BASE: 'http://api.test',
  isServerConfigured: () => true,
}));

type MembersRead = Awaited<ReturnType<typeof teamAccessClient.listMembers>>;
type LinkWrite = Awaited<ReturnType<typeof teamAccessClient.setMemberResourceLink>>;
type ResourceLink = TeamMember['resourceLink'];

function makeMember(userId: string, name: string, resourceLink: ResourceLink = null): TeamMember {
  return {
    userId,
    role: userId === 'me' ? 'owner' : 'editor',
    status: 'active',
    manage: userId !== 'me',
    createdAt: '2026-01-01T00:00:00.000Z',
    name,
    email: `${userId}@x.io`,
    signInConfirmed: null,
    isSelf: userId === 'me',
    resourceLink,
  };
}

function makeRead(links: { ed?: ResourceLink; bea?: ResourceLink } = {}): MembersRead {
  const value: TeamDirectory = {
    signInTrackingEnabled: false,
    resourceCandidates: [
      { resourceId: 'r-bruce', label: 'Bruce Wayne' },
      { resourceId: 'r-diana', label: 'Diana Prince' },
    ],
    members: [
      makeMember('me', 'Selina Kyle'),
      makeMember('ed', 'Clark Kent', links.ed),
      makeMember('bea', 'Barbara Gordon', links.bea),
    ],
  };
  return { kind: 'ok', status: 200, value };
}

const bruce = { resourceId: 'r-bruce', revision: 'rev-2' };
const diana = { resourceId: 'r-diana', revision: 'rev-3' };

// Holds each call until the test settles it, oldest first, so reads and writes can race on cue.
function holdCalls<T>(): { calls: ((result: T) => void)[]; settleNext(result: T): Promise<void> } {
  const calls: ((result: T) => void)[] = [];
  return {
    calls,
    async settleNext(result) {
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      const settle = calls.shift();
      await act(async () => {
        settle?.(result);
        await Promise.resolve();
      });
    },
  };
}

function controlRequests() {
  const reads = holdCalls<MembersRead>();
  const writes = holdCalls<LinkWrite>();
  const listMembers = vi
    .spyOn(teamAccessClient, 'listMembers')
    .mockResolvedValueOnce(makeRead())
    .mockImplementation(() => new Promise((resolve) => reads.calls.push(resolve)));
  vi.spyOn(teamAccessClient, 'listInvitations').mockResolvedValue({
    kind: 'ok',
    status: 200,
    value: [],
  });
  const setLink = vi
    .spyOn(teamAccessClient, 'setMemberResourceLink')
    .mockImplementation(() => new Promise((resolve) => writes.calls.push(resolve)));
  return { reads, writes, listMembers, setLink };
}

async function openResourceDialog(user: User, email: RegExp): Promise<HTMLElement> {
  const row = await waitForMemberRow(email);
  await user.click(within(row).getByTestId('member-resource-menu'));
  return screen.findByRole('dialog');
}

function getSelector(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('combobox', { name: /choose Resource/i });
}

async function choosePerson(user: User, dialog: HTMLElement, name: string): Promise<void> {
  await user.click(getSelector(dialog));
  await user.click(screen.getByRole('option', { name }));
}

async function closeDialog(user: User, dialog: HTMLElement): Promise<void> {
  await user.click(within(dialog).getByRole('button', { name: /close/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

beforeEach(async () => {
  await resetStoreWithAccount();
  vi.stubGlobal('fetch', mockApi());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MembersSection — resource link read fence', () => {
  it('keeps the link pending until a read requested after the write succeeds', async () => {
    const user = userEvent.setup();
    const { reads, writes, listMembers, setLink } = controlRequests();
    renderSection();
    const dialog = await openResourceDialog(user, /ed@x\.io/);
    await choosePerson(user, dialog, 'Bruce Wayne');
    await writes.settleNext({ kind: 'ok', status: 200, value: bruce });

    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
    expect(getSelector(dialog)).toBeDisabled();
    expect(within(dialog).getByRole('status')).toHaveTextContent(m.settings_members_updating());

    await reads.settleNext(makeRead({ ed: bruce }));
    await waitFor(() => expect(getSelector(dialog)).toBeEnabled());
    expect(within(dialog).getByRole('status')).toHaveTextContent('Resource link updated.');
    await choosePerson(user, dialog, 'Diana Prince');
    expect(setLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceId: 'r-diana', expectedRevision: 'rev-2' }),
    );
  });

  it('does not let a read already in flight before the write release it', async () => {
    const user = userEvent.setup();
    const { reads, writes, listMembers } = controlRequests();
    renderSection();
    const edDialog = await openResourceDialog(user, /ed@x\.io/);
    await choosePerson(user, edDialog, 'Bruce Wayne');
    await writes.settleNext({ kind: 'ok', status: 200, value: bruce });
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
    await closeDialog(user, edDialog);

    // Barbara's write starts while the read requested for Clark's write is still in flight.
    const beaDialog = await openResourceDialog(user, /bea@x\.io/);
    await choosePerson(user, beaDialog, 'Diana Prince');
    await reads.settleNext(makeRead({ ed: bruce }));
    expect(getSelector(beaDialog)).toBeDisabled();
    await writes.settleNext({ kind: 'ok', status: 200, value: diana });
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(3));
    expect(getSelector(beaDialog)).toBeDisabled();

    await reads.settleNext(makeRead({ ed: bruce, bea: diana }));
    await waitFor(() => expect(getSelector(beaDialog)).toBeEnabled());
  });

  it('keeps the request pending across closing and reopening the dialog', async () => {
    const user = userEvent.setup();
    const { reads, writes } = controlRequests();
    renderSection();
    const dialog = await openResourceDialog(user, /ed@x\.io/);
    await choosePerson(user, dialog, 'Bruce Wayne');
    await closeDialog(user, dialog);

    const sendingDialog = await openResourceDialog(user, /ed@x\.io/);
    expect(getSelector(sendingDialog)).toBeDisabled();
    await writes.settleNext({ kind: 'ok', status: 200, value: bruce });
    expect(getSelector(sendingDialog)).toBeDisabled();
    await closeDialog(user, sendingDialog);

    const refreshingDialog = await openResourceDialog(user, /ed@x\.io/);
    expect(getSelector(refreshingDialog)).toBeDisabled();
    await reads.settleNext(makeRead({ ed: bruce }));
    await waitFor(() => expect(getSelector(refreshingDialog)).toBeEnabled());
  });

  // Revisions alone cannot tell this refresh apart: before the write and after the concurrent
  // unlink, the member has no link and so no revision.
  it('releases on the fresh read after a concurrent unlink and retries from no link', async () => {
    const user = userEvent.setup();
    const { reads, writes, setLink } = controlRequests();
    renderSection();
    const dialog = await openResourceDialog(user, /ed@x\.io/);
    await choosePerson(user, dialog, 'Bruce Wayne');
    await writes.settleNext({ kind: 'ok', status: 200, value: bruce });
    await waitFor(() => expect(getSelector(dialog)).toBeDisabled());

    await reads.settleNext(makeRead({ ed: null }));
    await waitFor(() => expect(getSelector(dialog)).toBeEnabled());
    expect(within(dialog).getByRole('status')).toBeEmptyDOMElement();
    await choosePerson(user, dialog, 'Bruce Wayne');
    expect(setLink).toHaveBeenCalledTimes(2);
    expect(setLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceId: 'r-bruce', expectedRevision: null }),
    );
  });
});
