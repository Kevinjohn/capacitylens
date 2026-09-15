interface PendingInvitationPreselection {
  accountId: string;
  userId: string;
  resourceId: string;
}

let pending: PendingInvitationPreselection | null = null;

/** One-shot in-memory handoff from a Resource row to Team & access. */
export function setInvitationPreselection(accountId: string, userId: string, resourceId: string): void {
  pending = { accountId, userId, resourceId };
}

export function takeInvitationPreselection(accountId: string, userId: string): string | null {
  if (!pending || pending.accountId !== accountId || pending.userId !== userId) return null;
  const resourceId = pending.resourceId;
  pending = null;
  return resourceId;
}

export function clearInvitationPreselection(): void {
  pending = null;
}
