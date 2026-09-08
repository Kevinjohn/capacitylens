import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { accountClient, readUnknownAccountCommandOutcome } from "@/account/accountClient";
import { readSessions } from "@/account/sessionClient";
import type { SessionView } from "@/account/sessionClient";
import { authClient } from "@/auth/authClient";
import type { AuthProviderInfo } from "@/auth/authContext";
import { useFieldError } from "@/hooks/useFieldError";
import { m } from "@/i18n";
import { reloadPage } from "@/lib/reloadPage";

type SessionReloadResult = { kind: "loaded" | "unauthorized" | "failed" | "superseded" };
type Fail = ReturnType<typeof useFieldError>["fail"];

function readIdentityProviderStatus(body: unknown): { connected: boolean } {
  if (!body || typeof body !== "object") throw new Error("Invalid identity-provider status response.");
  const status = body as { connected?: unknown; verified?: unknown };
  if (typeof status.connected !== "boolean" || typeof status.verified !== "boolean") {
    throw new Error("Invalid identity-provider status response.");
  }
  return { connected: status.connected };
}

function readIdentityLinkResult(body: unknown): { url?: unknown; code?: unknown } | null {
  return body && typeof body === "object" ? body : null;
}

function isAlreadyLinked(result: { code?: unknown } | null): boolean {
  return result?.code === "PROVIDER_ALREADY_LINKED" || result?.code === "MULTIPLE_PROVIDER_LINKS";
}

function clearIdentityLinkParams(url: URL) {
  if (!url.searchParams.has("capacitylensSsoLinked") && !url.searchParams.has("capacitylensSsoLinkFailed")) return;
  url.searchParams.delete("capacitylensSsoLinked");
  url.searchParams.delete("capacitylensSsoLinkFailed");
  window.history.replaceState(window.history.state, "", url);
}

function useProviderConnection(
  strictProvider: AuthProviderInfo | undefined,
  busy: boolean,
  setBusy: (busy: boolean) => void,
) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!strictProvider) return;
    const requestGeneration = ++generation.current;
    const url = new URL(window.location.href);
    const linkFailed = url.searchParams.has("capacitylensSsoLinkFailed");
    void accountClient
      .getIdentityProvider()
      .then(async (response) => {
        if (!response.ok) throw new Error("Identity-provider status request failed.");
        const status = readIdentityProviderStatus(await response.json().catch(() => null));
        if (requestGeneration === generation.current) {
          setConnected(status.connected);
          setError(linkFailed ? m.settings_sso_connect_error() : null);
        }
      })
      .catch((cause: unknown) => {
        console.error("SecuritySection: identity-provider status failed", cause);
        if (requestGeneration === generation.current) setError(m.settings_sso_status_error());
      });
    clearIdentityLinkParams(url);
    return () => {
      generation.current += 1;
    };
  }, [strictProvider]);

  const connect = async () => {
    if (!strictProvider || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await accountClient.linkIdentityProvider(window.location.href);
      const result = readIdentityLinkResult(await response.json().catch(() => null));
      if (response.status === 409 && isAlreadyLinked(result)) {
        setConnected(true);
        setError(result?.code === "MULTIPLE_PROVIDER_LINKS" ? m.settings_sso_status_error() : null);
        setBusy(false);
        return;
      }
      if (!response.ok || typeof result?.url !== "string") throw new Error("Invalid identity-link response.");
      window.location.assign(result.url);
    } catch (cause) {
      console.error("SecuritySection: identity-provider link failed", cause);
      setError(m.settings_sso_connect_error());
      setBusy(false);
    }
  };

  return { connected, error, connect };
}

function useSessions(fail: Fail, clear: () => void, setMessage: (message: string | null) => void) {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const generation = useRef(0);
  const load = useCallback(async (): Promise<SessionReloadResult> => {
    const requestGeneration = ++generation.current;
    const result = await readSessions();
    if (requestGeneration !== generation.current) return { kind: "superseded" };
    if (result.kind === "loaded") {
      setSessions(result.sessions);
      clear();
      return { kind: "loaded" };
    }
    fail(
      null,
      result.kind === "invalid" ? m.settings_security_err_sessions_invalid() : m.settings_security_err_sessions_load(),
    );
    return { kind: result.kind === "unauthorized" ? "unauthorized" : "failed" };
  }, [clear, fail]);

  useEffect(() => {
    const requestGeneration = generation.current;
    queueMicrotask(() => {
      if (requestGeneration === generation.current) void load();
    });
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const reconcileUnknown = async (mustReenter: boolean) => {
    if (mustReenter) return reloadPage();
    const outcome = await load();
    if (outcome.kind === "unauthorized") return reloadPage();
    setMessage(
      outcome.kind === "loaded"
        ? m.settings_security_revoke_unknown_refreshed()
        : m.settings_security_revoke_unknown_unavailable(),
    );
  };

  return { sessions, setSessions, load, reconcileUnknown };
}

interface PasswordChangeInput {
  fail: Fail;
  clear: () => void;
  setMessage: (message: string | null) => void;
  loadSessions: () => Promise<SessionReloadResult>;
  setBusy: (busy: boolean) => void;
}

function usePasswordChange({ fail, clear, setMessage, loadSessions, setBusy }: PasswordChangeInput) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    clear();
    setMessage(null);
    if (passwordLengthFailure(newPassword)) {
      fail("new", m.settings_security_err_password_length({ min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) return fail("confirm", m.settings_security_err_password_mismatch());
    setBusy(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (result.error) return fail("current", result.error.message ?? m.settings_security_err_password_change());
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(m.settings_security_password_changed());
      await loadSessions();
    } catch (cause) {
      console.error("SecuritySection: password change failed", cause);
      fail("current", m.settings_security_err_auth_unavailable());
    } finally {
      setBusy(false);
    }
  };

  return {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    submit,
  };
}

export function useSecurityController(strictProvider: AuthProviderInfo | undefined) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fieldError = useFieldError();
  const sessionController = useSessions(fieldError.fail, fieldError.clear, setMessage);
  const password = usePasswordChange({
    fail: fieldError.fail,
    clear: fieldError.clear,
    setMessage,
    loadSessions: sessionController.load,
    setBusy,
  });
  const provider = useProviderConnection(strictProvider, busy, setBusy);

  const revoke = async (sessionId: string) => {
    const revokingCurrent = sessionController.sessions.some((session) => session.id === sessionId && session.current);
    setBusy(true);
    fieldError.clear();
    setMessage(null);
    try {
      const response = await accountClient.revokeOwnSession(sessionId);
      if (!response.ok && (await readUnknownAccountCommandOutcome(response))) {
        await sessionController.reconcileUnknown(revokingCurrent || response.status === 401);
      } else if (!response.ok) {
        fieldError.fail(null, m.settings_security_err_revoke());
      } else {
        sessionController.setSessions((current) => current.filter((session) => session.id !== sessionId));
        setMessage(m.settings_security_revoked());
        if (revokingCurrent) reloadPage();
      }
    } catch (cause) {
      console.error("SecuritySection: session revoke failed", cause);
      await sessionController.reconcileUnknown(revokingCurrent);
    } finally {
      setBusy(false);
    }
  };

  return { busy, message, fieldError, password, provider, sessions: sessionController.sessions, revoke };
}
