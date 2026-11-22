import { beforeEach, describe, expect, it, vi } from 'vitest';

const memberRequests = vi.hoisted(() => ({ transferOwnership: vi.fn() }));
vi.mock('./memberRequests', () => ({ memberRequests }));

import { ownershipTransferAccess } from './ownershipTransferAccess';

describe('ownership transfer access', () => {
  beforeEach(() => memberRequests.transferOwnership.mockReset());

  it('accepts only the two-ID receipt returned after the immediate role swap', async () => {
    memberRequests.transferOwnership.mockResolvedValue(
      Response.json({ data: { fromUserId: 'bruce', toUserId: 'selina' } }),
    );

    await expect(
      ownershipTransferAccess.transferOwnership({
        companyId: 'wayne-enterprises',
        targetUserId: 'selina',
        confirmationId: 'proof-1',
      }),
    ).resolves.toEqual({
      kind: 'ok',
      status: 200,
      value: { fromUserId: 'bruce', toUserId: 'selina' },
    });
  });

  it('treats a malformed receipt as uncertain instead of claiming the transfer failed', async () => {
    memberRequests.transferOwnership.mockResolvedValue(
      Response.json({ data: { state: 'awaiting_target' } }),
    );

    await expect(
      ownershipTransferAccess.transferOwnership({
        companyId: 'wayne-enterprises',
        targetUserId: 'selina',
        confirmationId: 'proof-1',
      }),
    ).resolves.toMatchObject({ kind: 'invalid', status: 200 });
  });
});
