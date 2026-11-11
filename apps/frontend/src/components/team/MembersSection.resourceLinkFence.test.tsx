import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { m } from '@/i18n';
import { teamAccessClient } from '@/account/teamAccessClient';
import type { TeamDirectory, TeamMember } from '@/account/teamAccessClient';
import { resetStoreWithAccount } from '@/test/fixtures';
import { holdCalls } from '@/test/holdCalls';
import {
  expectNotice,
  mockApi,
  openInactiveGroup,
  renderSection,
  saveRoleVia,
  waitForMemberRow,
} from './MembersSection.testSupport';
import type { User } from './MembersSection.testSupport';

vi.mock('@/data/apiConfig', () => ({
  API_BASE: 'http://api.test',
  isServerConfigured: () => true,
}));

type MembersRead = Awaited<ReturnType<typeof teamAccessClient.listMembers>>;
type LinkWrite = Awaited<ReturnType<typeof teamAccessClient.setMemberResourceLink>>;
type UnlinkWrite = Awaited<ReturnType<typeof teamAccessClient.clearMemberResourceLink>>;
type InvitationsRead = Awaited<ReturnType<typeof teamAccessClient.listInvitations>>;
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

function makeRead(
  links: { ed?: ResourceLink; bea?: ResourceLink; sam?: ResourceLink } = {},
): MembersRead {
  // Sam is suspended, so his row lives in the collapsible inactive group.
  const suspended =
    links.sam === undefined
      ? []
      : [{ ...makeMember('sam', 'Bruce Banner', links.sam), status: 'suspended' as const }];
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
      ...suspended,
    ],
  };
  return { kind: 'ok', status: 200, value };
}

const bruce = { resourceId: 'r-bruce', revision: 'rev-2' };
const diana = { resourceId: 'r-diana', revision: 'rev-3' };

function controlRequests(initialRead = makeRead()) {
  const reads = holdCalls<MembersRead>();
  const writes = holdCalls<LinkWrite>();
  const unlinks = holdCalls<UnlinkWrite>();
  // Invitation reads answer at once unless a test holds them.
  const invitations = { ...holdCalls<InvitationsRead>(), hold: false };
  const listMembers = vi
    .spyOn(teamAccessClient, 'listMembers')
    .mockResolvedValueOnce(initialRead)
    .mockImplementation(() => new Promise((resolve) => reads.calls.push(resolve)));
  vi.spyOn(teamAccessClient, 'listInvitations').mockImplementation(() =>
    invitations.hold
      ? new Promise((resolve) => invitations.calls.push(resolve))
      : Promise.resolve({ kind: 'ok', status: 200, value: [] }),
  );
  const setLink = vi
    .spyOn(teamAccessClient, 'setMemberResourceLink')
    .mockImplementation(() => new Promise((resolve) => writes.calls.push(resolve)));
  vi.spyOn(teamAccessClient, 'clearMemberResourceLink').mockImplementation(
    () => new Promise((resolve) => unlinks.calls.push(resolve)),
  );
  return { reads, writes, unlinks, invitations, listMembers, setLink };
}

async function openResourceDialog(user: User, email: RegExp): Promise<HTMLElement> {
  const row = await waitForMemberRow(email);
  await user.click(within(row).getByTestId('member-resource-menu'));
  return screen.findByRole('dialog');
}

function getSelector(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('combobox', { name: /choose Resource/i });
}

function getRemoveButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', { name: /remove Resource link/i });
}

async function choosePerson(user: User, dialog: HTMLElement, name: string): Promise<void> {
  await user.click(getSelector(dialog));
  await user.click(screen.getByRole('option', { name }));
}

async function closeDialog(user: User, dialog: HTMLElement): Promise<void> {
  await user.click(within(dialog).getByRole('button', { name: /close/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

// Clark's write leaves its read held; Barbara then writes while that read is still in flight.
async function startBarbaraWriteDuringClarkRead(user: User) {
  const requests = controlRequests();
  renderSection();
  const edDialog = await openResourceDialog(user, /ed@x\.io/);
  await choosePerson(user, edDialog, 'Bruce Wayne');
  await requests.writes.settleNext({ kind: 'ok', status: 200, value: bruce });
  await waitFor(() => expect(requests.listMembers).toHaveBeenCalledTimes(2));
  await closeDialog(user, edDialog);
  const beaDialog = await openResourceDialog(user, /bea@x\.io/);
  await choosePerson(user, beaDialog, 'Diana Prince');
  return { ...requests, beaDialog };
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
    const { reads, writes, listMembers, beaDialog } = await startBarbaraWriteDuringClarkRead(user);
    await writes.settleNext({ kind: 'ok', status: 200, value: diana });
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(3));

    await reads.settleNext(makeRead({ ed: bruce }));
    expect(getSelector(beaDialog)).toBeDisabled();
    await reads.settleNext(makeRead({ ed: bruce, bea: diana }));
    await waitFor(() => expect(getSelector(beaDialog)).toBeEnabled());
  });

  it('does not let an earlier read that lands while the write is sending release it', async () => {
    const user = userEvent.setup();
    const { reads, writes, listMembers, beaDialog } = await startBarbaraWriteDuringClarkRead(user);
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
    expect(within(refreshingDialog).getByRole('status')).toHaveTextContent(
      'Resource link updated.',
    );
  });

  it('keeps Remove link to resource disabled while sending and refreshing, across reopening', async () => {
    const user = userEvent.setup();
    const linked = { resourceId: 'r-bruce', revision: 'rev-1' };
    const { reads, writes } = controlRequests(makeRead({ ed: linked }));
    renderSection();
    const dialog = await openResourceDialog(user, /ed@x\.io/);
    await choosePerson(user, dialog, 'Diana Prince');
    expect(getRemoveButton(dialog)).toBeDisabled();
    await closeDialog(user, dialog);

    const sendingDialog = await openResourceDialog(user, /ed@x\.io/);
    expect(getRemoveButton(sendingDialog)).toBeDisabled();
    await writes.settleNext({ kind: 'ok', status: 200, value: diana });
    expect(getRemoveButton(sendingDialog)).toBeDisabled();
    await closeDialog(user, sendingDialog);

    const refreshingDialog = await openResourceDialog(user, /ed@x\.io/);
    expect(getRemoveButton(refreshingDialog)).toBeDisabled();
    await reads.settleNext(makeRead({ ed: diana }));
    await waitFor(() => expect(getRemoveButton(refreshingDialog)).toBeEnabled());
  });

  it('clears a finished success on reopen but keeps an unknown outcome', async () => {
    const user = userEvent.setup();
    const { reads, writes } = controlRequests();
    renderSection();
    const dialog = await openResourceDialog(user, /ed@x\.io/);
    await choosePerson(user, dialog, 'Bruce Wayne');
    await writes.settleNext({ kind: 'ok', status: 200, value: bruce });
    await reads.settleNext(makeRead({ ed: bruce }));
    await waitFor(() =>
      expect(within(dialog).getByRole('status')).toHaveTextContent('Resource link updated.'),
    );
    await closeDialog(user, dialog);
    const reopened = await openResourceDialog(user, /ed@x\.io/);
    expect(within(reopened).getByRole('status')).toBeEmptyDOMElement();

    await choosePerson(user, reopened, 'Diana Prince');
    await writes.settleNext({ kind: 'unknown', status: 409, message: null });
    await reads.settleNext(makeRead({ ed: diana }));
    await waitFor(() => expect(getSelector(reopened)).toBeEnabled());
    await closeDialog(user, reopened);
    const afterUnknown = await openResourceDialog(user, /ed@x\.io/);
    expect(within(afterUnknown).getByRole('alert')).toHaveTextContent(
      m.settings_member_resource_unknown(),
    );
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

  it('keeps an unlink pending after its row leaves and returns to the inactive group', async () => {
    const user = userEvent.setup();
    const linked = { resourceId: 'r-bruce', revision: 'rev-1' };
    const { reads, unlinks } = controlRequests(makeRead({ sam: linked }));
    renderSection();
    await openInactiveGroup(user);
    const dialog = await openResourceDialog(user, /sam@x\.io/);
    await user.click(getRemoveButton(dialog));
    await unlinks.settleNext({ kind: 'ok', status: 204, value: true });
    await closeDialog(user, dialog);
    await user.click(screen.getByTestId('members-inactive-toggle'));
    await waitFor(() => expect(screen.queryByTestId('members-inactive-table')).toBeNull());

    await openInactiveGroup(user);
    const reopened = await openResourceDialog(user, /sam@x\.io/);
    expect(getRemoveButton(reopened)).toBeDisabled();
    await reads.settleNext(makeRead({ sam: null }));
    await waitFor(() =>
      expect(
        within(reopened).queryByRole('button', { name: /remove Resource link/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it('keeps a write that is still sending pending across a failed member read', async () => {
    const user = userEvent.setup();
    const { reads, writes, listMembers } = controlRequests();
    renderSection();
    // Barbara's finished write requests the read that fails while Clark's write is sending.
    const beaDialog = await openResourceDialog(user, /bea@x\.io/);
    await choosePerson(user, beaDialog, 'Diana Prince');
    await writes.settleNext({ kind: 'ok', status: 200, value: diana });
    await closeDialog(user, beaDialog);
    const edDialog = await openResourceDialog(user, /ed@x\.io/);
    await choosePerson(user, edDialog, 'Bruce Wayne');
    await closeDialog(user, edDialog);
    await reads.settleNext({ kind: 'rejected', status: 500, message: null });
    await user.click(await screen.findByRole('button', { name: m.settings_members_retry() }));
    await reads.settleNext(makeRead({ bea: diana }));

    const reopened = await openResourceDialog(user, /ed@x\.io/);
    expect(getSelector(reopened)).toBeDisabled();
    await writes.settleNext({ kind: 'ok', status: 200, value: bruce });
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(4));
    expect(getSelector(reopened)).toBeDisabled();
    await reads.settleNext(makeRead({ ed: bruce, bea: diana }));
    await waitFor(() => expect(getSelector(reopened)).toBeEnabled());
  });

  it('ignores a reconciliation read that began before a newer accepted read', async () => {
    const user = userEvent.setup();
    const { reads, writes, invitations, setLink } = controlRequests();
    vi.spyOn(teamAccessClient, 'changeMemberRole').mockResolvedValue({
      kind: 'unknown',
      status: 500,
      message: null,
    });
    renderSection();
    const edDialog = await openResourceDialog(user, /ed@x\.io/);
    await choosePerson(user, edDialog, 'Bruce Wayne');
    await closeDialog(user, edDialog);

    // Barbara's uncertain role change reconciles with a read taken before Clark's link lands.
    invitations.hold = true;
    await saveRoleVia(user, await waitForMemberRow(/bea@x\.io/), 'Viewer');
    await waitFor(() => expect(invitations.calls).toHaveLength(1));
    invitations.hold = false;
    await reads.settleNext(makeRead());
    await writes.settleNext({ kind: 'ok', status: 200, value: bruce });
    await reads.settleNext(makeRead({ ed: bruce }));
    await invitations.settleNext({ kind: 'ok', status: 200, value: [] });
    await expectNotice(/./);

    const edRow = await waitForMemberRow(/ed@x\.io/);
    expect(within(edRow).getByTestId('member-resource-status')).toHaveTextContent('Bruce Wayne');
    const reopened = await openResourceDialog(user, /ed@x\.io/);
    await waitFor(() => expect(getSelector(reopened)).toBeEnabled());
    await choosePerson(user, reopened, 'Diana Prince');
    expect(setLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceId: 'r-diana', expectedRevision: 'rev-2' }),
    );
  });
});
