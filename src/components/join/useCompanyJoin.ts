import { useEffect, useState, type FormEvent } from "react";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { parseApprovedDomain } from "@capacitylens/shared/account/approvedDomains";
import { companyJoinClient } from "../../account/companyJoinClient";
import { authClient } from "../../auth/authClient";
import { useAuth, type AuthProviderInfo } from "../../auth/authContext";
import { isServerConfigured } from "../../data/apiConfig";
import { readApiError } from "../../lib/readApiError";
import { replaceWithJoinedAccount } from "../../lib/joinedAccountHandoff";
import { m } from "@/i18n";
import { runExternalSignIn } from "../invites/externalSignIn";
import { readMetadata, readStatus, resolveJoinStatus } from "./joinStatus";
import type { Metadata } from "./joinStatus";

type Stage = "loading" | "entry" | "pending" | "approved" | "second-factor" | "joined" | "error" | "local";
async function responseError(response: Response): Promise<string> {
  return (await readApiError(response)) ?? m.joining_failed();
}

async function readJoinResponses([metadataResponse, statusResponse, microsoftResponse]: [
  Response,
  Response,
  Response,
]) {
  if (!metadataResponse.ok || !statusResponse.ok || !microsoftResponse.ok) throw new Error();
  const metadata = readMetadata(await metadataResponse.json());
  const local = readStatus(await statusResponse.json());
  const microsoft = readStatus(await microsoftResponse.json());
  if (!metadata || !local || !microsoft) throw new Error();
  return { metadata, local, microsoft };
}

// eslint-disable-next-line max-lines-per-function -- The account-keyed journey coordinates provider, password MFA and completion state.
export function useCompanyJoin(accountId: string | undefined, invitationToken: string | null) {
  const { user, refreshAuth, providers = [], authMode } = useAuth();
  const [stage, setStage] = useState<Stage>(isServerConfigured() ? "loading" : "local");
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [email, setEmail] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [providerId, setProviderId] = useState<string | null>(null);
  const [existingPassword, setExistingPassword] = useState("");
  const [secondFactorCode, setSecondFactorCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [secondFactorVerified, setSecondFactorVerified] = useState(false);
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
  const hasMicrosoft = providers.some((provider) => provider.id === "microsoft");

  useEffect(() => {
    if (!accountId || !isServerConfigured()) return;
    const request = { active: true };
    const isRequestActive = () => request.active;
    void (async () => {
      try {
        const [metadataResponse, statusResponse, microsoftResponse] = await Promise.all([
          companyJoinClient.metadata(accountId),
          companyJoinClient.status(),
          hasMicrosoft ? companyJoinClient.microsoftStatus() : Promise.resolve(Response.json({ state: "expired" })),
        ]);
        if (!isRequestActive()) return;
        const decoded = await readJoinResponses([metadataResponse, statusResponse, microsoftResponse]);
        if (!isRequestActive()) return;
        setMetadata(decoded.metadata);
        if (new URLSearchParams(window.location.search).has("externalSignInError"))
          setError(m.joining_provider_failed());
        const status = resolveJoinStatus({
          accountId,
          purpose: invitationToken ? "invitation" : "policy",
          local: decoded.local,
          microsoft: decoded.microsoft,
        });
        if (!status.matched) {
          setStage("entry");
          return;
        }
        setEmailHint(status.emailHint);
        if (status.email) setEmail(status.email);
        setProviderId(status.providerId);
        setStage(status.stage);
        if (status.deliveryUnavailable) setError(m.joining_mail_failed());
      } catch {
        if (request.active) {
          setError(m.joining_failed());
          setStage("error");
        }
      }
    })();
    return () => {
      request.active = false;
    };
  }, [accountId, invitationToken, hasMicrosoft]);

  const startProvider = async (provider: AuthProviderInfo) => {
    const selectedProviderId = provider.id;
    if (!accountId || busy) return;
    if (!isAccountEmail(email) || parseApprovedDomain(email.slice(email.lastIndexOf("@") + 1)) === null) {
      setError(m.identity_err_email());
      return;
    }
    setBusy(true);
    setError(null);
    await runExternalSignIn({
      start: async (signal) => {
        const response =
          selectedProviderId === "microsoft"
            ? await companyJoinClient.startMicrosoft({ accountId, email, invitationToken }, signal)
            : await companyJoinClient.startProvider(
                { accountId, email, invitationToken, providerId: selectedProviderId },
                signal,
              );
        if (!response.ok) return { error: { message: await responseError(response) } };
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("url" in body) || typeof body.url !== "string")
          return { error: { message: m.joining_failed() } };
        setProviderId(selectedProviderId);
        return { data: { url: body.url } };
      },
      onFailure: (message) => {
        setError(message ?? m.login_failed());
        setBusy(false);
      },
      onRequestError: () => {
        setError(m.login_network_error());
        setBusy(false);
      },
      onCachedReturn: () => {
        setError(m.login_failed());
        setBusy(false);
      },
    });
  };

  const runAction = async (fallback: string, action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy || providerId !== "microsoft") return;
    await runAction(m.joining_failed(), async () => {
      const response = await companyJoinClient.microsoftResend();
      if (!response.ok) throw new Error(await responseError(response));
    });
  };

  const restart = async () => {
    await runAction(m.joining_failed(), async () => {
      const responses = await Promise.all([
        companyJoinClient.cancel(),
        ...(hasMicrosoft ? [companyJoinClient.microsoftCancel()] : []),
      ]);
      const failed = responses.find((response) => !response.ok);
      if (failed) throw new Error(await responseError(failed));
      setStage("entry");
    });
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
        const signIn = await authClient.signIn.email({ email, password: existingPassword });
        if (signIn.error) throw new Error(signIn.error.message ?? m.login_failed());
        if ((signIn.data as { twoFactorRedirect?: unknown } | null)?.twoFactorRedirect === true) {
          setStage("second-factor");
          return;
        }
      }
      await completeExisting();
    });
  };

  const verifySecondFactor = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || (!secondFactorVerified && !secondFactorCode)) return;
    await runAction(m.login_network_error(), async () => {
      if (!secondFactorVerified) {
        const result = useRecoveryCode
          ? await authClient.twoFactor.verifyBackupCode({ code: secondFactorCode, trustDevice: false })
          : await authClient.twoFactor.verifyTotp({ code: secondFactorCode, trustDevice: false });
        if (result.error) throw new Error(result.error.message ?? m.login_failed());
        setSecondFactorVerified(true);
      }
      await completeExisting();
    });
  };

  const completeProvider = async () => {
    if (busy) return;
    await runAction(m.joining_failed(), async () => {
      await finish(
        await (providerId === "microsoft"
          ? companyJoinClient.completeMicrosoft(invitationToken)
          : companyJoinClient.completeProvider(invitationToken)),
      );
    });
  };

  const eligibleProviders = metadata?.providerAvailable
    ? providers.filter((provider) => authMode !== "sso-only" || (provider.id !== "github" && !provider.experimental))
    : [];
  return {
    stage,
    emailProofRequired,
    verificationSent,
    requestEmailVerification,
    metadata,
    passwordAvailable: metadata?.passwordAvailable === true && authMode !== "sso-only",
    emailVerificationAvailable: metadata?.emailVerificationAvailable === true && authMode !== "sso-only",
    email,
    emailHint,
    providerId,
    eligibleProviders,
    existingPassword,
    secondFactorCode,
    secondFactorVerified,
    useRecoveryCode,
    error,
    busy,
    user,
    setEmail,
    setExistingPassword,
    setSecondFactorCode,
    setUseRecoveryCode,
    startProvider,
    resend,
    restart,
    signInAndJoin,
    verifySecondFactor,
    completeProvider,
  };
}
