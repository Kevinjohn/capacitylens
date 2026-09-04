import type { Dispatch, SetStateAction, RefObject } from "react";
import type { InviteAcceptState } from "./InviteAcceptView";
import {
  accountClient,
  accountCommandOutcomeUnknown,
  newBrowserAccountCommand,
  type BrowserAccountCommand,
} from "../../account/accountClient";
import { m } from "@/i18n";
import { accountFailure, messageForStatus } from "./inviteResponses";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { isAccountRole } from "@capacitylens/shared/account/types";
import { useStore } from "../../store/useStore";

interface Dependencies {
  token: string | undefined;
  previewed: RefObject<string | null>;
  accepting: RefObject<boolean>;
  acceptCommand: RefObject<BrowserAccountCommand | null>;
  routeActive: RefObject<boolean>;
  setState: Dispatch<SetStateAction<InviteAcceptState>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
}

export function createInviteAcceptanceActions({
  token,
  previewed,
  accepting,
  acceptCommand,
  routeActive,
  setState,
  setBusy,
}: Dependencies) {
  const acceptInvite = async (): Promise<void> => {
    if (!token || previewed.current !== token || accepting.current) return;
    accepting.current = true;
    setBusy(true);
    setState({ kind: "accepting" });
    try {
      const command = acceptCommand.current ?? (acceptCommand.current = newBrowserAccountCommand());
      const res = await accountClient.acceptInvitation(token, command);
      if (!res.ok) {
        const outcomeUnknown = await accountCommandOutcomeUnknown(res);
        const failure = await accountFailure(res);
        if (res.status >= 400 && res.status < 500 && !outcomeUnknown) {
          acceptCommand.current = newBrowserAccountCommand();
        }
        if (res.status === 401) {
          setState({
            kind: "auth",
            message: messageForStatus(401, failure.message ?? undefined),
          });
        } else {
          let reconciliation = "";
          if (outcomeUnknown) {
            const list = await refreshAccountSummaries({
              allowCachedFallback: false,
            });
            reconciliation = list !== null ? m.invite_unknown_refreshed() : m.invite_unknown_refresh_failed();
          }
          setState({
            kind: "error",
            message:
              failure.code === "INVITATION_EMAIL_MISMATCH"
                ? m.invite_err_identity_mismatch()
                : outcomeUnknown
                  ? `${failure.message ?? m.invite_unknown_pending()} ${reconciliation}`
                  : messageForStatus(res.status, failure.message ?? undefined),
            retryAccept: outcomeUnknown,
            switchIdentity: failure.code === "INVITATION_EMAIL_MISMATCH",
          });
        }
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        accountId?: string;
        role?: string;
      };
      const accountId = typeof body.accountId === "string" && body.accountId.length > 0 ? body.accountId : "";
      if (!accountId || !isAccountRole(body.role)) {
        const list = await refreshAccountSummaries({
          allowCachedFallback: false,
        });
        setState({
          kind: "error",
          message: list !== null ? m.invite_invalid_result_refreshed() : m.invite_invalid_result_refresh_failed(),
        });
        return;
      }

      // Use the role returned by the mutation, not the proposed role in the preview: the server may
      // have resolved an existing membership with a different effective role.
      setState({ kind: "joined", accountId, role: body.role, activating: true });
      try {
        const list = await refreshAccountSummaries({
          signal: AbortSignal.timeout(5000),
          allowCachedFallback: false,
          preserveActiveAccountIfMissing: true,
        });
        // The directory refresh remains useful after navigation, but this route no longer owns the
        // global company selection once it has unmounted. A company chosen on the destination route
        // must not be replaced by this late invitation completion.
        if (routeActive.current && list !== null) {
          // This pre-session route deliberately has no persistence owner attached. Seed only the
          // verified handoff id; the fresh authenticated boot owns its hydration.
          if (list.some((account) => account.id === accountId)) useStore.getState().setActiveAccount(accountId);
        }
      } catch (error) {
        // The 2xx accept response already confirmed durable membership. Activation is a separate,
        // best-effort read: never relabel a confirmed join as an unknown mutation or invite retry.
        console.warn("InviteAccept: joined-company activation refresh failed", error);
      } finally {
        if (routeActive.current) {
          setState((current) => (current.kind === "joined" ? { ...current, activating: false } : current));
        }
      }
    } catch (error) {
      // The POST may have reached the server before the transport failed, so do not invite a blind
      // retry. Refresh authoritative membership state and explain how to verify the outcome.
      console.error("InviteAccept: accept request failed", error);
      const list = await refreshAccountSummaries({ allowCachedFallback: false });
      setState({
        kind: "error",
        message: list !== null ? m.invite_unknown_outcome_refreshed() : m.invite_unknown_outcome_refresh_failed(),
        retryAccept: true,
      });
    } finally {
      accepting.current = false;
      setBusy(false);
    }
  };

  return { acceptInvite };
}
