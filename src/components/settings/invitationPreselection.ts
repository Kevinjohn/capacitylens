import { useEffect, useRef } from "react";
import type { AccountMode } from "../../auth/authContext";

interface PendingInvitationPreselection {
  accountId: string;
  userId: string;
  sessionInstanceId: string | null;
  authMode: AccountMode;
  offlineReadOnly: boolean;
  online: boolean;
  resourceId: string;
}

export interface InvitationPreselectionContext {
  accountId: string;
  userId: string;
  sessionInstanceId: string | null;
  authMode: AccountMode;
  offlineReadOnly: boolean;
  online: boolean;
}

export interface InvitationPreselectionLifecycleContext {
  accountId: string | null;
  userId: string | null;
  sessionInstanceId: string | null;
  authMode: AccountMode;
  offlineReadOnly: boolean;
  online: boolean;
  permissionStatus: "not-applicable" | "pending" | "resolved" | "unavailable";
  mayManage: boolean;
}

let pending: PendingInvitationPreselection | null = null;

/** One-shot in-memory handoff from a Resource row to Team & access. */
export function setInvitationPreselection(context: InvitationPreselectionContext, resourceId: string): void {
  pending = { ...context, resourceId };
}

function matchesContext(
  pendingContext: PendingInvitationPreselection,
  context: InvitationPreselectionContext,
): boolean {
  return (
    pendingContext.accountId === context.accountId &&
    pendingContext.userId === context.userId &&
    pendingContext.sessionInstanceId === context.sessionInstanceId &&
    pendingContext.authMode === context.authMode &&
    pendingContext.offlineReadOnly === context.offlineReadOnly &&
    pendingContext.online === context.online
  );
}

export function peekInvitationPreselection(context: InvitationPreselectionContext): string | null {
  if (!pending || !matchesContext(pending, context)) return null;
  return pending.resourceId;
}

/** Claim only from a commit/effect phase after the matching Team context is mounted. */
export function claimInvitationPreselection(context: InvitationPreselectionContext): string | null {
  if (!pending) return null;
  if (!matchesContext(pending, context)) {
    pending = null;
    return null;
  }
  const resourceId = pending.resourceId;
  pending = null;
  return resourceId;
}

export function clearInvitationPreselection(): void {
  pending = null;
}

/**
 * Keeps the transient handoff attached to the authoritative Team route boundary. It runs above the
 * permission/offline gates, so a denied or disconnected destination cannot retain a private draft
 * for a later account or session. The deferred unmount cleanup is StrictMode-safe: its second
 * development-only mount cancels the first cleanup before it can clear a valid handoff.
 */
export function useInvitationPreselectionLifecycle(context: InvitationPreselectionLifecycleContext): void {
  const lifecycleGeneration = useRef(0);
  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    return () => {
      queueMicrotask(() => {
        // The ref is deliberately shared with the StrictMode remount generation guard.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (lifecycleGeneration.current === generation) clearInvitationPreselection();
      });
    };
  }, []);

  useEffect(() => {
    if (
      context.accountId === null ||
      context.userId === null ||
      context.sessionInstanceId === null ||
      context.authMode === "off" ||
      context.offlineReadOnly ||
      !context.online
    ) {
      clearInvitationPreselection();
      return;
    }
    const current: InvitationPreselectionContext = {
      accountId: context.accountId,
      userId: context.userId,
      sessionInstanceId: context.sessionInstanceId,
      authMode: context.authMode,
      offlineReadOnly: context.offlineReadOnly,
      online: context.online,
    };
    if (pending === null) return;
    if (!matchesContext(pending, current)) {
      clearInvitationPreselection();
      return;
    }
    if (context.permissionStatus === "unavailable" || (context.permissionStatus !== "pending" && !context.mayManage)) {
      clearInvitationPreselection();
    }
  }, [context]);
}
