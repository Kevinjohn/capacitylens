import type { Dispatch, SetStateAction, RefObject } from "react";
import type { InviteAcceptState } from "./InviteAcceptView";
import {
  accountClient,
  readUnknownAccountCommandOutcome,
  createBrowserAccountCommand,
  type BrowserAccountCommand,
} from "../../account/accountClient";
import { m } from "@/i18n";
import { readAccountFailure, resolveMessageForStatus } from "./inviteResponses";
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

interface SignupCredentials {
  name: string;
  email: string;
  password: string;
}

interface SignupAttempt {
  commandOutcomeUnknown: boolean;
}

interface SignupRequest {
  token: string;
  signupCommand: RefObject<BrowserAccountCommand | null>;
}

function readSignupAccountId(signupBody: unknown): string | null {
  if (typeof signupBody !== "object" || signupBody === null) return null;
  if (!("accountId" in signupBody) || typeof signupBody.accountId !== "string" || signupBody.accountId.length === 0) {
    return null;
  }
  if (!("role" in signupBody) || !isAccountRole(signupBody.role)) return null;
  return signupBody.accountId;
}

function validateSignupCredentials(
  { name, email, password }: Pick<Dependencies, "name" | "email" | "password">,
  report: (errorField: string | null, message: string) => void,
): SignupCredentials | null {
  const cleanName = validateText(name, report, {
    field: "name",
    requiredMessage: m.identity_err_name(),
  });
  if (cleanName === null) return null;
  const cleanEmail = normalizeAccountEmail(email);
  if (!isAccountEmail(cleanEmail)) {
    report("email", m.identity_err_email());
    return null;
  }
  if (passwordLengthFailure(password)) {
    report(
      "password",
      m.identity_err_password({
        min: MIN_PASSWORD_LENGTH,
        max: MAX_PASSWORD_LENGTH,
      }),
    );
    return null;
  }
  return { name: cleanName, email: cleanEmail, password };
}

async function submitInvitationSignup(
  { token, signupCommand }: SignupRequest,
  credentials: SignupCredentials,
  attempt: SignupAttempt,
): Promise<string> {
  const command = signupCommand.current ?? (signupCommand.current = createBrowserAccountCommand());
  const response = await accountClient.signupWithInvitation(token, credentials, command);
  if (!response.ok) {
    attempt.commandOutcomeUnknown = await readUnknownAccountCommandOutcome(response);
    const failure = await readAccountFailure(response);
    if (response.status >= 400 && response.status < 500 && !attempt.commandOutcomeUnknown) {
      signupCommand.current = createBrowserAccountCommand();
    }
    throw new Error(failure.message ?? resolveMessageForStatus(response.status, undefined));
  }
  const signupBody: unknown = await response.json().catch(() => null);
  const accountId = readSignupAccountId(signupBody);
  if (accountId === null) throw new Error(m.invite_signup_invalid_result());
  return accountId;
}

async function recoverUnknownSignup({ email, password }: SignupCredentials): Promise<boolean> {
  try {
    const signInResult = await authClient.signIn.email({ email, password });
    if (signInResult.error) return false;
    // Do not guess from the caller's company count: the signup request may never have reached
    // the server and these credentials may belong to an existing identity. Reload the same
    // bearer URL; an unused invite can then be accepted explicitly, while a consumed invite
    // truthfully reports that state and lets the caller inspect their authenticated picker.
    reloadPage();
    return true;
  } catch (signInError) {
    // The recovery probe is best-effort and may fail for the same network reason as signup.
    // Keep the original unknown-outcome guidance and restore the form instead of leaking a
    // rejected event-handler promise that leaves the page permanently busy.
    console.warn("InviteAccept: signup recovery sign-in failed", signInError);
    return false;
  }
}

function resolveSignupFailureMessage(error: unknown, unknownFailure: boolean): string {
  if (unknownFailure) return m.invite_signup_unknown();
  if (error instanceof Error) return error.message;
  return m.invite_err_generic();
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
    const credentials = validateSignupCredentials({ name, email, password }, report);
    if (credentials === null) return;
    setBusy(true);
    setState({ kind: "auth" });
    const attempt: SignupAttempt = { commandOutcomeUnknown: false };
    try {
      const accountId = await submitInvitationSignup({ token, signupCommand }, credentials, attempt);
      const { error } = await authClient.signIn.email({
        email: credentials.email,
        password: credentials.password,
      });
      if (error) throw new Error(error.message ?? m.login_failed());
      // Signup already claimed the invite atomically. Verify the exact company, then start a fresh
      // authenticated boot with persistence attached and a one-use activation handoff.
      await enterJoinedCompany(accountId);
    } catch (error) {
      const unknownFailure = isTransportFailure(error) || attempt.commandOutcomeUnknown;
      if (unknownFailure && (await recoverUnknownSignup(credentials))) return;
      setState({
        kind: "auth",
        message: resolveSignupFailureMessage(error, unknownFailure),
      });
      setBusy(false);
    }
  };

  return { createAccount };
}
