import { describe, expect, it } from 'vitest';
import { formatInviteExpiryDate } from './inviteExpiry';

describe('invite expiry formatters', () => {
  it.each(['2026-09-10T14:05:37.000Z', '2027-01-02T09:07:59.000Z'])(
    "formats the invitation date on the viewer's local calendar for %s",
    (expiresAt) => {
      expect(formatInviteExpiryDate(expiresAt)).toBe(new Date(expiresAt).toLocaleDateString());
      expect(formatInviteExpiryDate(expiresAt)).not.toContain(':');
    },
  );
});
