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

type Stage = "loading" | "entry" | "pending" | "approved" | "joined" | "error" | "local";
interface Metadata { companyName: string; passwordAvailable: boolean; providerAvailable: boolean }

function readMetadata(value: unknown): Metadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.companyName !== "string" || !row.companyName.trim() ||
      typeof row.passwordAvailable !== "boolean" || typeof row.providerAvailable !== "boolean") return null;
  return { companyName: row.companyName, passwordAvailable: row.passwordAvailable,
    providerAvailable: row.providerAvailable };
}

function readStatus(value: unknown): { state: "expired" | "pending" | "approved"; accountId?: string;
  purpose?: string; email?: string; emailHint?: string; deliveryUnavailable?: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.state !== "expired" && row.state !== "pending" && row.state !== "approved") return null;
  return { state: row.state,
    ...(typeof row.accountId === "string" ? { accountId: row.accountId } : {}),
    ...(typeof row.purpose === "string" ? { purpose: row.purpose } : {}),
    ...(typeof row.email === "string" ? { email: row.email } : {}),
    ...(typeof row.emailHint === "string" ? { emailHint: row.emailHint } : {}),
    ...(row.deliveryUnavailable === true ? { deliveryUnavailable: true } : {}) };
}

async function responseError(response: Response): Promise<string> {
  return (await readApiError(response)) ?? m.joining_failed();
}

// eslint-disable-next-line max-lines-per-function -- One account-keyed browser journey owns the proof, retry and completion state.
export function useCompanyJoin(accountId: string | undefined, invitationToken: string | null) {
  const { user, refreshAuth } = useAuth();
  const [stage, setStage] = useState<Stage>(isServerConfigured() ? "loading" : "local");
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [email, setEmail] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [existingPassword, setExistingPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accountId || !isServerConfigured()) return;
    const request = { active: true };
    const isCurrent = () => request.active;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    // eslint-disable-next-line complexity -- The load distinguishes expired, pending, approved and mailed states.
    void (async () => {
      try {
        const [metadataResponse, statusResponse] = await Promise.all([
          companyJoinClient.metadata(accountId), companyJoinClient.status(),
        ]);
        if (!isCurrent()) return;
        if (!metadataResponse.ok || !statusResponse.ok) throw new Error(m.joining_failed());
        const decodedMetadata = readMetadata(await metadataResponse.json());
        const status = readStatus(await statusResponse.json());
        if (!decodedMetadata || !status) throw new Error(m.joining_failed());
        if (!isCurrent()) return;
        setMetadata(decodedMetadata);
        const matches = status.accountId === accountId &&
          status.purpose === (invitationToken ? "invitation" : "policy");
        if (!matches || status.state === "expired") {
          if (token) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
          return setStage("entry");
        }
        setEmailHint(status.emailHint ?? "");
        if (status.email) setEmail(status.email);
        if (token) {
          window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
          const confirmed = await companyJoinClient.confirm(token);
          if (!isCurrent()) return;
          if (!confirmed.ok) setError(await responseError(confirmed));
          else return setStage("approved");
        }
        setStage(status.state === "approved" ? "approved" : "pending");
        if (status.deliveryUnavailable) setError(m.joining_mail_failed());
      } catch {
        if (isCurrent()) { setError(m.joining_failed()); setStage("error"); }
      }
    })();
    return () => { request.active = false; };
  }, [accountId, invitationToken]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountId || busy) return;
    if (!isAccountEmail(email) || parseApprovedDomain(email.slice(email.lastIndexOf("@") + 1)) === null) {
      return setError(m.identity_err_email());
    }
    setBusy(true);
    setError(null);
    try {
      const response = await companyJoinClient.start({ accountId, email, invitationToken });
      if (!response.ok) throw new Error(await responseError(response));
      const result: unknown = await response.json();
      if (!result || typeof result !== "object") throw new Error(m.joining_failed());
      const body = result as Record<string, unknown>;
      setEmailHint(typeof body.emailHint === "string" ? body.emailHint : "");
      setStage("pending");
      if (body.deliveryUnavailable === true) setError(m.joining_mail_failed());
    } catch (cause) { setError(cause instanceof Error ? cause.message : m.joining_failed()); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await companyJoinClient.resend();
      if (!response.ok) throw new Error(await responseError(response));
    } catch (cause) { setError(cause instanceof Error ? cause.message : m.joining_failed()); }
    finally { setBusy(false); }
  };

  const restart = async () => {
    setBusy(true);
    try { await companyJoinClient.cancel(); }
    finally { setStage("entry"); setError(null); setBusy(false); }
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : m.joining_failed()); }
    finally { setBusy(false); }
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
      }
      await finish(await companyJoinClient.completeExisting(invitationToken));
    } catch (cause) { setError(cause instanceof Error ? cause.message : m.joining_failed()); }
    finally { setBusy(false); }
  };

  return { stage, metadata, email, emailHint, displayName, password, existingPassword,
    error, busy, user, setEmail, setDisplayName, setPassword, setExistingPassword,
    start, resend, restart, createAccount, signInAndJoin };
}
