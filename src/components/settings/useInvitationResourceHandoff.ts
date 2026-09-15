/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import type { AuthUser, AuthMode } from "../../auth/authContext";
import { claimInvitationPreselection, clearInvitationPreselection } from "./invitationPreselection";

interface InvitationResourceHandoffInput {
  activeAccountId: string | null;
  authMode: AuthMode;
  directoryAuthorized: boolean;
  directoryPending: boolean;
  enabled: boolean;
  offlineReadOnly: boolean;
  online: boolean;
  resetInviteDraft: () => void;
  sessionGeneration: number;
  user: AuthUser | null;
}

export function useInvitationResourceHandoff({
  activeAccountId,
  authMode,
  directoryAuthorized,
  directoryPending,
  enabled,
  offlineReadOnly,
  online,
  resetInviteDraft,
  sessionGeneration,
  user,
}: InvitationResourceHandoffInput): string | null {
  const [proposedResourceId, setProposedResourceId] = useState<string | null>(null);
  useEffect(() => {
    const contextReady = enabled && online && !offlineReadOnly && activeAccountId !== null && user !== null;
    if (!contextReady || (!directoryAuthorized && !directoryPending)) {
      clearInvitationPreselection();
      setProposedResourceId(null);
      resetInviteDraft();
      return;
    }
    if (directoryPending) return;
    const claimed = claimInvitationPreselection({
      accountId: activeAccountId,
      userId: user.id,
      sessionGeneration,
      authMode,
      offlineReadOnly,
      online,
    });
    if (claimed !== null) setProposedResourceId(claimed);
  }, [
    activeAccountId,
    authMode,
    directoryAuthorized,
    directoryPending,
    enabled,
    offlineReadOnly,
    online,
    resetInviteDraft,
    sessionGeneration,
    user,
  ]);
  return proposedResourceId;
}
