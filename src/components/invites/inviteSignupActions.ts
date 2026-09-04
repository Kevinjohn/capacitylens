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
import { authClient } from "../../auth/authClient";
import { reloadPage } from "../../lib/reloadPage";
import { validateText } from "../../lib/validation";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { isAccountRole } from "@capacitylens/shared/account/types";
import { isTransportFailure } from "../../data/requestTimeout";

interface Dependencies {
  token: string | undefined;
  previewed: RefObject<string | null>;
  name: string;
  email: string;
  password: string;
  signupCommand: RefObject<BrowserAccountCommand | null>;
  enterJoinedCompany: (accountId?: string) => Promise<void>;
  setState: Dispatch<SetStateAction<InviteAcceptState>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
}

export function createInviteSignupActions({
  token,
  previewed,
  name,
  email,
  password,
  signupCommand,
  enterJoinedCompany,
  setState,
  setBusy,
}: Dependencies) {
  const createAccount = async () => {
    if (!token || previewed.current !== token) return;
    const report = (errorField: string | null, message: string) => {
      setState({ kind: "auth", message, errorField });
    };
    const cleanName = validateText(name, report, {
      field: "name",
      requiredMessage: m.identity_err_name(),
    });
    if (cleanName === null) return;
    const cleanEmail = normalizeAccountEmail(email);
    if (!isAccountEmail(cleanEmail)) {
      report("email", m.identity_err_email());
      return;
    }
    if (passwordLengthFailure(password)) {
      report(
        "password",
        m.identity_err_password({
          min: MIN_PASSWORD_LENGTH,
          max: MAX_PASSWORD_LENGTH,
        }),
      );
      return;
    }
    setBusy(true);
    setState({ kind: "auth" });
    let commandOutcomeUnknown = false;
    try {
      const command = signupCommand.current ?? (signupCommand.current = newBrowserAccountCommand());
      const res = await accountClient.signupWithInvitation(
        token,
        {
          name: cleanName,
          email: cleanEmail,
          password,
        },
        command,
      );
      if (!res.ok) {
        commandOutcomeUnknown = await accountCommandOutcomeUnknown(res);
        const failure = await accountFailure(res);
        if (res.status >= 400 && res.status < 500 && !commandOutcomeUnknown) {
          signupCommand.current = newBrowserAccountCommand();
        }
        throw new Error(failure.message ?? messageForStatus(res.status, undefined));
      }
      const signupBody = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const accountId =
        typeof signupBody?.accountId === "string" && signupBody.accountId.length > 0 ? signupBody.accountId : null;
      if (!accountId || !isAccountRole(signupBody?.role)) {
        throw new Error(m.invite_signup_invalid_result());
      }
      const { error } = await authClient.signIn.email({
        email: cleanEmail,
        password,
      });
      if (error) throw new Error(error.message ?? m.login_failed());
      // Signup already claimed the invite atomically. Verify the exact company, then start a fresh
      // authenticated boot with persistence attached and a one-use activation handoff.
      await enterJoinedCompany(accountId);
    } catch (error) {
      const unknownFailure = isTransportFailure(error) || commandOutcomeUnknown;
      if (unknownFailure) {
        try {
          const signInResult = await authClient.signIn.email({
            email: cleanEmail,
            password,
          });
          if (!signInResult.error) {
            // Do not guess from the caller's company count: the signup request may never have reached
            // the server and these credentials may belong to an existing identity. Reload the same
            // bearer URL; an unused invite can then be accepted explicitly, while a consumed invite
            // truthfully reports that state and lets the caller inspect their authenticated picker.
            reloadPage();
            return;
          }
        } catch (signInError) {
          // The recovery probe is best-effort and may fail for the same network reason as signup.
          // Keep the original unknown-outcome guidance and restore the form instead of leaking a
          // rejected event-handler promise that leaves the page permanently busy.
          console.warn("InviteAccept: signup recovery sign-in failed", signInError);
        }
      }
      setState({
        kind: "auth",
        message: unknownFailure
          ? m.invite_signup_unknown()
          : error instanceof Error
            ? error.message
            : m.invite_err_generic(),
      });
      setBusy(false);
    }
  };

  return { createAccount };
}
