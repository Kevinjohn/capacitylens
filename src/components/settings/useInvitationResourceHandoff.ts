/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import type { AuthUser, AuthMode } from "../../auth/authContext";
import { claimInvitationPreselection, clearInvitationPreselection } from "./invitationPreselection";

interface InvitationResourceHandoffInput {
  activeAccountId: string | null;
  authMode: AuthMode;
  directoryAuthorized: boolean;
  directoryContextKey: string;
  directoryPending: boolean;
  enabled: boolean;
  offlineReadOnly: boolean;
  online: boolean;
  resetInviteDraft: () => void;
  sessionInstanceId: string | null;
  user: AuthUser | null;
}

export function useInvitationResourceHandoff({
  activeAccountId,
  authMode,
  directoryAuthorized,
  directoryContextKey,
  directoryPending,
  enabled,
  offlineReadOnly,
  online,
  resetInviteDraft,
  sessionInstanceId,
  user,
}: InvitationResourceHandoffInput): string | null {
  const [proposedResourceId, setProposedResourceId] = useState<string | null>(null);
  useEffect(() => {
    const contextReady =
      enabled && online && !offlineReadOnly && activeAccountId !== null && user !== null && sessionInstanceId !== null;
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
      sessionInstanceId,
      authMode,
      offlineReadOnly,
      online,
    });
    if (claimed !== null) setProposedResourceId(claimed);
  }, [
    activeAccountId,
    authMode,
    directoryAuthorized,
    directoryContextKey,
    directoryPending,
    enabled,
    offlineReadOnly,
    online,
    resetInviteDraft,
    sessionInstanceId,
    user,
  ]);
  return proposedResourceId;
}
