import type { MemberDirectoryEntry } from '#services/membership/member_directory';

const validMember: MemberDirectoryEntry = {
  userId: 'principal-clark',
  role: 'editor',
  status: 'active',
  accessDisabled: false,
  membershipPresent: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  name: null,
  email: null,
  signInConfirmed: null,
  isSelf: false,
  resourceLink: null,
};

const invalidRole: MemberDirectoryEntry = {
  ...validMember,
  // @ts-expect-error Database projections must not widen the shared role vocabulary.
  role: 'operator',
};

const invalidStatus: MemberDirectoryEntry = {
  ...validMember,
  // @ts-expect-error Database projections must not widen the shared membership lifecycle.
  status: 'removed',
};

void invalidRole;
void invalidStatus;
