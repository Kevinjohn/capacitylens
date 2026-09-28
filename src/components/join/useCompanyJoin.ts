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

type Stage = "loading" | "entry" | "pending" | "approved" | "second-factor" | "joined" | "error" | "local";
interface Metadata {
  companyName: string;
  passwordAvailable: boolean;
  providerAvailable: boolean;
}

function readMetadata(value: unknown): Metadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.companyName !== "string" ||
    !row.companyName.trim() ||
    typeof row.passwordAvailable !== "boolean" ||
    typeof row.providerAvailable !== "boolean"
  )
    return null;
  return {
    companyName: row.companyName,
    passwordAvailable: row.passwordAvailable,
    providerAvailable: row.providerAvailable,
  };
}

// eslint-disable-next-line complexity -- Provider status has independent optional fields from two endpoints.
function readStatus(value: unknown): {
  state: "expired" | "pending" | "approved";
  accountId?: string;
  purpose?: string;
  providerId?: string;
  email?: string;
  emailHint?: string;
  deliveryUnavailable?: boolean;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.state !== "expired" && row.state !== "pending" && row.state !== "approved") return null;
  return {
    state: row.state,
    ...(typeof row.accountId === "string" ? { accountId: row.accountId } : {}),
    ...(typeof row.purpose === "string" ? { purpose: row.purpose } : {}),
    ...(typeof row.providerId === "string" ? { providerId: row.providerId } : {}),
    ...(typeof row.email === "string" ? { email: row.email } : {}),
    ...(typeof row.emailHint === "string" ? { emailHint: row.emailHint } : {}),
    ...(row.deliveryUnavailable === true ? { deliveryUnavailable: true } : {}),
  };
}

async function responseError(response: Response): Promise<string> {
  return (await readApiError(response)) ?? m.joining_failed();
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
    const token = new URLSearchParams(window.location.hash.slice(1)).get("verify");
    if (token) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }
  }, []);
  const hasMicrosoft = providers.some((provider) => provider.id === "microsoft");

  useEffect(() => {
    if (!accountId || !isServerConfigured()) return;
    const request = { active: true };
    // eslint-disable-next-line complexity -- Reconcile the two provider proof states with the current account and purpose.
    void (async () => {
      try {
        const [metadataResponse, statusResponse, microsoftResponse] = await Promise.all([
          companyJoinClient.metadata(accountId),
          companyJoinClient.status(),
          hasMicrosoft ? companyJoinClient.microsoftStatus() : Promise.resolve(Response.json({ state: "expired" })),
        ]);
        if (!request.active) return;
        if (!metadataResponse.ok || !statusResponse.ok || !microsoftResponse.ok) throw new Error();
        const decodedMetadata = readMetadata(await metadataResponse.json());
        const localStatus = readStatus(await statusResponse.json());
        const microsoftStatus = readStatus(await microsoftResponse.json());
        if (!decodedMetadata || !localStatus || !microsoftStatus) throw new Error();
        setMetadata(decodedMetadata);
        if (new URLSearchParams(window.location.search).has("externalSignInError"))
          setError(m.joining_provider_failed());
        const purpose = invitationToken ? "invitation" : "policy";
        const microsoftMatches =
          microsoftStatus.accountId === accountId &&
          microsoftStatus.purpose === purpose &&
          microsoftStatus.state !== "expired";
        const status = microsoftMatches ? microsoftStatus : localStatus;
        if (status.accountId !== accountId || status.purpose !== purpose || status.state === "expired") {
          setStage("entry");
          return;
        }
        setEmailHint(status.emailHint ?? "");
        if (status.email) setEmail(status.email);
        setProviderId(status.providerId ?? null);
        if (status.state === "approved") setStage("approved");
        else if (status.providerId === "microsoft") setStage("pending");
        else setStage("entry");
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

  const resend = async () => {
    if (busy || providerId !== "microsoft") return;
    setBusy(true);
    setError(null);
    try {
      const response = await companyJoinClient.microsoftResend();
      if (!response.ok) throw new Error(await responseError(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.joining_failed());
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setBusy(true);
    setError(null);
    try {
      const responses = await Promise.all([
        companyJoinClient.cancel(),
        ...(hasMicrosoft ? [companyJoinClient.microsoftCancel()] : []),
      ]);
      const failed = responses.find((response) => !response.ok);
      if (failed) throw new Error(await responseError(failed));
      setStage("entry");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.joining_failed());
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
      setError(m.joining_mail_failed());
    } finally {
      setBusy(false);
    }
  };

  const signInAndJoin = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || invitationToken) return;
    setBusy(true);
    setError(null);
    try {
      if (!user) {
        const signIn = await authClient.signIn.email({ email, password: existingPassword });
        if (signIn.error) throw new Error(signIn.error.message ?? m.login_failed());
        if ((signIn.data as { twoFactorRedirect?: unknown } | null)?.twoFactorRedirect === true) {
          setStage("second-factor");
          return;
        }
      }
      await completeExisting();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.joining_failed());
    } finally {
      setBusy(false);
    }
  };

  const verifySecondFactor = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || (!secondFactorVerified && !secondFactorCode)) return;
    setBusy(true);
    setError(null);
    try {
      if (!secondFactorVerified) {
        const result = useRecoveryCode
          ? await authClient.twoFactor.verifyBackupCode({ code: secondFactorCode, trustDevice: false })
          : await authClient.twoFactor.verifyTotp({ code: secondFactorCode, trustDevice: false });
        if (result.error) throw new Error(result.error.message ?? m.login_failed());
        setSecondFactorVerified(true);
      }
      await completeExisting();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.login_network_error());
    } finally {
      setBusy(false);
    }
  };

  const completeProvider = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await finish(
        await (providerId === "microsoft"
          ? companyJoinClient.completeMicrosoft(invitationToken)
          : companyJoinClient.completeProvider(invitationToken)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.joining_failed());
    } finally {
      setBusy(false);
    }
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
