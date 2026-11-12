import { formatInstantDate } from '@/lib/dateDisplay';

/** Formats the date-only invite deadline used by the outstanding-invites list. */
export function formatInviteExpiryDate(expiresAt: string): string {
  return formatInstantDate(expiresAt);
}
