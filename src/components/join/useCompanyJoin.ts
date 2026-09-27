import { useEffect, useState, type FormEvent } from "react";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { parseApprovedDomain } from "@capacitylens/shared/account/approvedDomains";
import { companyJoinClient } from "../../account/companyJoinClient";
import { authClient } from "../../auth/authClient";
import { useAuth } from "../../auth/authContext";
import { isServerConfigured } from "../../data/apiConfig";
import { readApiError } from "../../lib/readApiError";
import { replaceWithJoinedAccount } from "../../lib/joinedAccountHandoff";
import { m } from "@/i18n";
import type { AuthProviderInfo } from "../../auth/authContext";
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

// eslint-disable-next-line complexity -- The response fields are independent optional values from either proof endpoint.
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

// eslint-disable-next-line max-lines-per-function -- One account-keyed browser journey owns the proof, retry and completion state.
export function useCompanyJoin(accountId: string | undefined, invitationToken: string | null) {
  const { user, refreshAuth, providers = [], authMode } = useAuth();
  const [stage, setStage] = useState<Stage>(isServerConfigured() ? "loading" : "local");
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [email, setEmail] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [providerId, setProviderId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [existingPassword, setExistingPassword] = useState("");
  const [secondFactorCode, setSecondFactorCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [secondFactorVerified, setSecondFactorVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasMicrosoft = providers.some((provider) => provider.id === "microsoft");

  useEffect(() => {
    if (!accountId || !isServerConfigured()) return;
    const request = { active: true };
    const isCurrent = () => request.active;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    // eslint-disable-next-line complexity -- The load reconciles both proof endpoints before rendering one journey.
    void (async () => {
      try {
        const [metadataResponse, statusResponse, microsoftResponse] = await Promise.all([
          companyJoinClient.metadata(accountId),
          companyJoinClient.status(),
          hasMicrosoft ? companyJoinClient.microsoftStatus() : Promise.resolve(Response.json({ state: "expired" })),
        ]);
        if (!isCurrent()) return;
        if (!metadataResponse.ok || !statusResponse.ok || !microsoftResponse.ok) throw new Error(m.joining_failed());
        const decodedMetadata = readMetadata(await metadataResponse.json());
        const localStatus = readStatus(await statusResponse.json());
        const microsoftStatus = readStatus(await microsoftResponse.json());
        const microsoftMatches =
          microsoftStatus?.accountId === accountId &&
          microsoftStatus.purpose === (invitationToken ? "invitation" : "policy") &&
          microsoftStatus.state !== "expired";
        const status = microsoftMatches ? microsoftStatus : localStatus;
        if (!decodedMetadata || !status) throw new Error(m.joining_failed());
        if (!isCurrent()) return;
        setMetadata(decodedMetadata);
        const externalError = new URLSearchParams(window.location.search).get("externalSignInError");
        if (externalError) setError(m.joining_provider_failed());
        const matches =
          status.accountId === accountId && status.purpose === (invitationToken ? "invitation" : "policy");
        if (!matches || status.state === "expired") {
          if (token)
            window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
          return setStage("entry");
        }
        setEmailHint(status.emailHint ?? "");
        if (status.email) setEmail(status.email);
        setProviderId(status.providerId ?? null);
        if (token && (!status.providerId || status.providerId === "password")) {
          window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
          const confirmed = await companyJoinClient.confirm(token);
          if (!isCurrent()) return;
          if (!confirmed.ok) setError(await responseError(confirmed));
          else return setStage("approved");
        }
        if (status.state === "approved") setStage("approved");
        else if (status.providerId && status.providerId !== "password" && status.providerId !== "microsoft")
          setStage("entry");
        else setStage("pending");
        if (status.deliveryUnavailable) setError(m.joining_mail_failed());
      } catch {
        if (isCurrent()) {
          setError(m.joining_failed());
          setStage("error");
        }
      }
    })();
    return () => {
      request.active = false;
    };
  }, [accountId, invitationToken, hasMicrosoft]);

  // eslint-disable-next-line complexity -- This action distinguishes validation, delivery, and cancellation failures.
  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountId || busy) return;
    if (!isAccountEmail(email) || parseApprovedDomain(email.slice(email.lastIndexOf("@") + 1)) === null) {
      return setError(m.identity_err_email());
    }
    setBusy(true);
    setError(null);
    try {
      if (hasMicrosoft) {
        const cancelled = await companyJoinClient.microsoftCancel();
        if (!cancelled.ok) throw new Error(await responseError(cancelled));
      }
      const response = await companyJoinClient.start({ accountId, email, invitationToken });
      if (!response.ok) throw new Error(await responseError(response));
      const result: unknown = await response.json();
      if (!result || typeof result !== "object") throw new Error(m.joining_failed());
      const body = result as Record<string, unknown>;
      setEmailHint(typeof body.emailHint === "string" ? body.emailHint : "");
      setProviderId("password");
      setStage("pending");
      if (body.deliveryUnavailable === true) setError(m.joining_mail_failed());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.joining_failed());
    } finally {
      setBusy(false);
    }
  };

  const startProvider = async (provider: AuthProviderInfo) => {
    const providerId = provider.id;
    if (!accountId || busy) return;
    if (!isAccountEmail(email) || parseApprovedDomain(email.slice(email.lastIndexOf("@") + 1)) === null) {
      setError(m.identity_err_email());
      return;
    }
    setBusy(true);
    setError(null);
    await runExternalSignIn({
      start: async (signal) => {
        let cancelled: Response | null = null;
        if (providerId === "microsoft") cancelled = await companyJoinClient.cancel();
        else if (hasMicrosoft) cancelled = await companyJoinClient.microsoftCancel();
        if (cancelled && !cancelled.ok) return { error: { message: await responseError(cancelled) } };
        const response =
          providerId === "microsoft"
            ? await companyJoinClient.startMicrosoft({ accountId, email, invitationToken }, signal)
            : await companyJoinClient.startProvider({ accountId, email, invitationToken, providerId }, signal);
        if (!response.ok) return { error: { message: await responseError(response) } };
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("url" in body) || typeof body.url !== "string") {
          return { error: { message: m.joining_failed() } };
        }
        setProviderId(providerId);
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
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await (providerId === "microsoft"
        ? companyJoinClient.microsoftResend()
        : companyJoinClient.resend(invitationToken));
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
      const responses = await Promise.all([companyJoinClient.cancel(), ...(hasMicrosoft ? [companyJoinClient.microsoftCancel()] : [])]);
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

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await companyJoinClient.completeNew({ displayName, password, invitationToken });
      if (!response.ok) throw new Error(await responseError(response));
      const signIn = await authClient.signIn.email({ email, password });
      if (signIn.error) throw new Error(signIn.error.message ?? m.login_failed());
      await finish(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.joining_failed());
    } finally {
      setBusy(false);
    }
  };

  const signInAndJoin = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
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
      await finish(await companyJoinClient.completeExisting(invitationToken));
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
      await finish(await companyJoinClient.completeExisting(invitationToken));
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
    metadata,
    email,
    emailHint,
    providerId,
    eligibleProviders,
    displayName,
    password,
    existingPassword,
    secondFactorCode,
    secondFactorVerified,
    useRecoveryCode,
    error,
    busy,
    user,
    setEmail,
    setDisplayName,
    setPassword,
    setExistingPassword,
    setSecondFactorCode,
    setUseRecoveryCode,
    start,
    startProvider,
    resend,
    restart,
    createAccount,
    signInAndJoin,
    verifySecondFactor,
    completeProvider,
  };
}
