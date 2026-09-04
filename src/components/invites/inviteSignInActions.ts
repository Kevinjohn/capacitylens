import type { Dispatch, SetStateAction } from "react";
import type { InviteAcceptState } from "./InviteAcceptView";
import { m } from "@/i18n";
import type { AuthProviderInfo } from "../../auth/authContext";
import { authClient } from "../../auth/authClient";
import { reloadPage } from "../../lib/reloadPage";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { useStore } from "../../store/useStore";
import { replaceWithAccountPicker, replaceWithJoinedAccount } from "../../lib/joinedAccountHandoff";
import { externalSignInErrorUrl } from "../../auth/externalSignInError";
import { runExternalSignIn } from "./externalSignIn";
import type { FormEvent } from "react";

interface Dependencies {
  email: string;
  password: string;
  refreshAuth: () => Promise<void>;
  setState: Dispatch<SetStateAction<InviteAcceptState>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
}

export function createInviteSignInActions({ email, password, refreshAuth, setState, setBusy }: Dependencies) {
  const signInAndReload = async (): Promise<void> => {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) throw new Error(error.message ?? m.login_failed());
    reloadPage();
  };

  /** Recheck the new cookie and authoritative companies before entering AppShell. The invite page
   * booted without a session, so its initial persistence bootstrap is deliberately unattached after
   * the 401. A fresh boot is required for safe saving; its one-use query value is verified against
   * `/api/accounts` by AppShell before activation and then removed from the URL. */
  const enterJoinedCompany = async (accountId?: string): Promise<void> => {
    await refreshAuth();
    const list = await refreshAccountSummaries({
      signal: AbortSignal.timeout(5000),
      allowCachedFallback: false,
    });
    if (list !== null) {
      const target = accountId
        ? list.find((account) => account.id === accountId)
        : list.length === 1
          ? list[0]
          : undefined;
      if (target) {
        // This route precedes the authenticated persistence lifecycle. The destination boot
        // re-verifies and hydrates the selected company from this already-authoritative directory.
        useStore.getState().setActiveAccount(target.id);
        replaceWithJoinedAccount(target.id);
        return;
      }
    }
    // A failed authoritative list read cannot safely activate a caller-supplied id. Reboot into the
    // ordinary authenticated picker, which retries the list without trusting the invite response.
    replaceWithAccountPicker();
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setState({ kind: "auth" });
    try {
      await signInAndReload();
    } catch (error) {
      setState({
        kind: "auth",
        message: error instanceof Error ? error.message : m.login_failed(),
      });
      setBusy(false);
    }
  };

  const signInWithProvider = async (provider: AuthProviderInfo): Promise<void> => {
    setBusy(true);
    setState({ kind: "auth" });
    await runExternalSignIn({
      start: (signal) =>
        provider.kind === "oidc"
          ? authClient.signIn.oauth2({
              providerId: provider.id,
              callbackURL: window.location.href,
              errorCallbackURL: externalSignInErrorUrl(window.location.href),
              // Keep redirect ownership in runExternalSignIn: Better Auth returns the provider URL
              // without running its internal navigation hook, and a timed-out request is aborted
              // before retry controls become available.
              disableRedirect: true,
              fetchOptions: { signal },
            })
          : authClient.signIn.social({
              provider: provider.id as "google" | "microsoft" | "github",
              callbackURL: window.location.href,
              errorCallbackURL: externalSignInErrorUrl(window.location.href),
              disableRedirect: true,
              fetchOptions: { signal },
            }),
      onFailure: (message) => {
        setState({ kind: "auth", message: message ?? m.login_failed() });
        setBusy(false);
      },
      onRequestError: (error) => {
        console.error("InviteAccept: SSO sign-in request failed", error);
        setState({ kind: "auth", message: m.login_network_error() });
        setBusy(false);
      },
      onCachedReturn: () => {
        setState({ kind: "auth", message: m.login_failed() });
        setBusy(false);
      },
    });
  };

  return { signIn, signInWithProvider, enterJoinedCompany };
}
