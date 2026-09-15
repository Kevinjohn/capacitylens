/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import type { AuthUser, AuthMode } from "../../auth/authContext";
import { claimInvitationPreselection, clearInvitationPreselection } from "./invitationPreselection";

interface InvitationResourceHandoffInput {
  activeAccountId: string | null;
  authMode: AuthMode;
  enabled: boolean;
  offlineReadOnly: boolean;
  online: boolean;
  sessionGeneration: number;
  user: AuthUser | null;
}

export function useInvitationResourceHandoff({
  activeAccountId,
  authMode,
  enabled,
  offlineReadOnly,
  online,
  sessionGeneration,
  user,
}: InvitationResourceHandoffInput): string | null {
  const [proposedResourceId, setProposedResourceId] = useState<string | null>(null);
  useEffect(() => {
    const contextReady = enabled && online && !offlineReadOnly && activeAccountId !== null && user !== null;
    if (!contextReady) {
      clearInvitationPreselection();
      setProposedResourceId(null);
      return;
    }
    const claimed = claimInvitationPreselection({
      accountId: activeAccountId,
      userId: user.id,
      sessionGeneration,
      authMode,
      offlineReadOnly,
      online,
    });
    if (claimed !== null) setProposedResourceId(claimed);
  }, [activeAccountId, authMode, enabled, offlineReadOnly, online, sessionGeneration, user]);
  return proposedResourceId;
}
