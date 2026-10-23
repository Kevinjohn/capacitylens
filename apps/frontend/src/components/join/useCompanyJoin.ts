import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_PASSWORD_INPUT_CODE_UNITS } from "@capacitylens/shared/domain/password";
import { companyJoinClient } from "@/account/companyJoinClient";
import { authClient } from "@/auth/authClient";
import { useAuth } from "@/auth/authContext";
import { isServerConfigured } from "@/data/apiConfig";
import { readApiError } from "@/lib/readApiError";
import { replaceWithJoinedAccount } from "@/lib/joinedAccountHandoff";
import { m } from "@/i18n";
import { readMetadata } from "./joinStatus";
import type { Metadata } from "./joinStatus";

type Stage = "loading" | "entry" | "joined" | "error" | "local";
async function responseError(response: Response): Promise<string> {
  return (await readApiError(response)) ?? m.joining_failed();
}

async function readMetadataResponse(metadataResponse: Response) {
  if (!metadataResponse.ok) throw new Error();
  const metadata = readMetadata(await metadataResponse.json());
  if (!metadata) throw new Error();
  return metadata;
}

/** Coordinates the account joining journey across sign-in methods and completion. */
export function useCompanyJoin(accountId: string | undefined, invitationToken: string | null) {
  const { user, refreshAuth } = useAuth();
  const [stage, setStage] = useState<Stage>(isServerConfigured() ? "loading" : "local");
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [email, setEmail] = useState("");
  const [existingPassword, setExistingPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationToken, setVerificationToken] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("verify"),
  );
  const [emailProofRequired, setEmailProofRequired] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  useEffect(() => {
    // Keep the one-time token out of the address bar and history once it is held in state.
    if (verificationToken) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }
  }, [verificationToken]);
  useEffect(() => {
    if (!accountId || !isServerConfigured()) return;
    const request = { active: true };
    const isRequestActive = () => request.active;
    void (async () => {
      try {
        const metadataResponse = await companyJoinClient.metadata(accountId);
        if (!isRequestActive()) return;
        const decoded = await readMetadataResponse(metadataResponse);
        if (!isRequestActive()) return;
        setMetadata(decoded);
        setStage("entry");
      } catch {
        // Only the active join lookup may publish failure after an account or request change.
        if (request.active) {
          setError(m.joining_failed());
          setStage("error");
        }
      }
    })();
    return () => {
      request.active = false;
    };
  }, [accountId, invitationToken]);

  const runAction = async (fallback: string, action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      // Surface the join operation failure so the caller can correct or retry it.
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (response: Response) => {
    if (!response.ok) throw new Error(await responseError(response));
    if (!accountId) throw new Error(m.joining_failed());
    await refreshAuth();
    setStage("joined");
    replaceWithJoinedAccount(accountId);
  };

  const completeExisting = async () => {
    if (!accountId) return;
    if (verificationToken) {
      // Drop the token first: a failed or expired link must not block later attempts.
      setVerificationToken(null);
      const confirmed = await companyJoinClient.confirmJoinEmailVerification(verificationToken);
      if (!confirmed.ok) throw new Error(await responseError(confirmed));
    }
    const response = await companyJoinClient.completeExisting(accountId);
    if (response.status === 401) {
      setEmailProofRequired(true);
      throw new Error(m.joining_trusted_proof_required());
    }
    await finish(response);
  };

  const requestEmailVerification = async () => {
    if (!accountId || busy) return;
    setBusy(true);
    setError(null);
    setVerificationSent(false);
    try {
      const response = await companyJoinClient.requestJoinEmailVerification(accountId);
      if (!response.ok) {
        setError(m.joining_mail_failed());
        return;
      }
      setVerificationSent(true);
    } catch {
      // Show an email-request failure so the user is not told to wait for a message that was not confirmed.
      setError(m.joining_mail_failed());
    } finally {
      setBusy(false);
    }
  };

  const signInAndJoin = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || invitationToken) return;
    await runAction(m.joining_failed(), async () => {
      if (!user) {
        const normalizedEmail = normalizeAccountEmail(email);
        if (!isAccountEmail(normalizedEmail)) {
          setError(m.identity_err_email());
          return;
        }
        if (existingPassword.length > MAX_PASSWORD_INPUT_CODE_UNITS) {
          setError(m.login_password_input_too_long());
          return;
        }
        const signIn = await authClient.signIn.email({ email: normalizedEmail, password: existingPassword });
        if (signIn.error) throw new Error(signIn.error.message);
      }
      await completeExisting();
    });
  };

  return {
    stage,
    emailProofRequired,
    verificationSent,
    requestEmailVerification,
    metadata,
    passwordAvailable: metadata?.passwordAvailable === true,
    emailVerificationAvailable: metadata?.emailVerificationAvailable === true,
    email,
    existingPassword,
    error,
    busy,
    user,
    setEmail,
    setExistingPassword,
    signInAndJoin,
  };
}
