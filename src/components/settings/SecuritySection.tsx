import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_INPUT_CODE_UNITS,
  passwordLengthFailure,
} from "@capacitylens/shared/domain/password";
import { authClient } from "../../auth/authClient";
import { accountClient, accountCommandOutcomeUnknown } from "../../account/accountClient";
import { m } from "@/i18n";
import { Button } from "../ui/button";
import { TextField } from "../common/fields";
import { FieldError, FieldGroup } from "../ui/field";
import { Separator } from "../ui/separator";
import { strictOidcProvider, useAuth } from "../../auth/authContext";
import { useFieldError } from "../../hooks/useFieldError";
import { formatInstant } from "../../lib/dateDisplay";
import { reloadPage } from "../../lib/reloadPage";
import { Badge } from "../ui/badge";
import { SettingsSection } from "./SettingsSection";
import { listSessions, type SessionView } from "../../account/sessionClient";

export function SecuritySection() {
  const { providers } = useAuth();
  const strictProvider = strictOidcProvider(providers);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [busy, setBusy] = useState(false);
  // Success copy is separate from the error surface: a revocation can succeed while an earlier
  // password error is still on screen, and only `useFieldError` owns the error half.
  const [message, setMessage] = useState<string | null>(null);
  // `errorField` carries which password input the error belongs to — "current" | "new" | "confirm".
  const { error, errorField, errorId, fail, clear } = useFieldError();
  const sessionLoadGeneration = useRef(0);
  const [providerConnected, setProviderConnected] = useState<boolean | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);

  useEffect(() => {
    if (!strictProvider) return;
    let cancelled = false;
    const url = new URL(window.location.href);
    const linkFailed = url.searchParams.has("capacitylensSsoLinkFailed");
    void (async () => {
      try {
        const response = await accountClient.getIdentityProvider();
        const body: unknown = await response.json().catch(() => null);
        if (
          !response.ok ||
          !body ||
          typeof body !== "object" ||
          typeof (body as { connected?: unknown }).connected !== "boolean" ||
          typeof (body as { verified?: unknown }).verified !== "boolean"
        ) {
          throw new Error("Invalid identity-provider status response.");
        }
        if (!cancelled) {
          const status = body as { connected: boolean; verified: boolean };
          // A duplicate or legacy-unverified row is still connected. Readiness owns its repair;
          // starting another link here would be guaranteed to conflict.
          setProviderConnected(status.connected);
          setProviderError(linkFailed ? m.settings_sso_connect_error() : null);
        }
      } catch (cause) {
        console.error("SecuritySection: identity-provider status failed", cause);
        if (!cancelled) setProviderError(m.settings_sso_status_error());
      }
    })();
    if (url.searchParams.has("capacitylensSsoLinked") || url.searchParams.has("capacitylensSsoLinkFailed")) {
      url.searchParams.delete("capacitylensSsoLinked");
      url.searchParams.delete("capacitylensSsoLinkFailed");
      window.history.replaceState(window.history.state, "", url);
    }
    return () => {
      cancelled = true;
    };
  }, [strictProvider]);

  const connectProvider = async () => {
    if (!strictProvider || busy) return;
    setBusy(true);
    setProviderError(null);
    try {
      const response = await accountClient.linkIdentityProvider(window.location.href);
      const body: unknown = await response.json().catch(() => null);
      const result = body && typeof body === "object" ? (body as { url?: unknown; code?: unknown }) : null;
      if (
        response.status === 409 &&
        (result?.code === "PROVIDER_ALREADY_LINKED" || result?.code === "MULTIPLE_PROVIDER_LINKS")
      ) {
        setProviderConnected(true);
        setProviderError(result.code === "MULTIPLE_PROVIDER_LINKS" ? m.settings_sso_status_error() : null);
        setBusy(false);
        return;
      }
      if (!response.ok || typeof result?.url !== "string") throw new Error("Invalid identity-link response.");
      window.location.assign(result.url);
    } catch (cause) {
      console.error("SecuritySection: identity-provider link failed", cause);
      setProviderError(m.settings_sso_connect_error());
      setBusy(false);
    }
  };

  const loadSessions = useCallback(async (): Promise<"loaded" | "unauthorized" | "failed" | "superseded"> => {
    const generation = ++sessionLoadGeneration.current;
    const result = await listSessions();
    if (generation !== sessionLoadGeneration.current) return "superseded";
    switch (result.kind) {
      case "invalid":
        fail(null, m.settings_security_err_sessions_invalid());
        return "failed";
      case "failed":
        fail(null, m.settings_security_err_sessions_load());
        return "failed";
      case "unauthorized":
        fail(null, m.settings_security_err_sessions_load());
        return "unauthorized";
      case "loaded":
        setSessions(result.sessions);
        clear();
        return "loaded";
    }
  }, [fail, clear]);

  useEffect(() => {
    // The state changes happen only after the external session request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSessions();
    return () => {
      sessionLoadGeneration.current += 1;
    };
  }, [loadSessions]);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    clear();
    setMessage(null);
    if (passwordLengthFailure(newPassword)) {
      fail(
        "new",
        m.settings_security_err_password_length({
          min: MIN_PASSWORD_LENGTH,
          max: MAX_PASSWORD_LENGTH,
        }),
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      fail("confirm", m.settings_security_err_password_mismatch());
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        fail("current", result.error.message ?? m.settings_security_err_password_change());
      } else {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setMessage(m.settings_security_password_changed());
        await loadSessions();
      }
    } catch (cause) {
      console.error("SecuritySection: password change failed", cause);
      fail("current", m.settings_security_err_auth_unavailable());
    } finally {
      setBusy(false);
    }
  };

  /**
   * Recover from a revocation whose OUTCOME IS UNKNOWN — the server may have committed before a
   * proxy/worker failure (an obscured response) or a transport error (a rejected request) hid the
   * answer. Both of those paths recover identically:
   *
   * `mustReenter` — this browser's own session may be gone, so no follow-up response can prove the
   * cookie survived: tenant data must leave the screen immediately through the auth wall. Otherwise
   * an authoritative list refresh reconciles it, and only an unauthorized refresh (which proves the
   * cookie is gone after all) falls back to the same reload.
   */
  const reconcileUnknownRevocation = async (mustReenter: boolean) => {
    if (mustReenter) {
      reloadPage();
      return;
    }
    const refreshOutcome = await loadSessions();
    if (refreshOutcome === "unauthorized") {
      reloadPage();
      return;
    }
    setMessage(
      refreshOutcome === "loaded"
        ? m.settings_security_revoke_unknown_refreshed()
        : m.settings_security_revoke_unknown_unavailable(),
    );
  };

  const revoke = async (sessionId: string) => {
    const revokingCurrentSession = sessions.some((session) => session.id === sessionId && session.current);
    setBusy(true);
    clear();
    setMessage(null);
    try {
      const response = await accountClient.revokeOwnSession(sessionId);
      if (!response.ok) {
        if (await accountCommandOutcomeUnknown(response)) {
          // A 401 is the second way this browser's own session can be the one that went: treat it
          // exactly like revoking the current session.
          await reconcileUnknownRevocation(revokingCurrentSession || response.status === 401);
        } else {
          fail(null, m.settings_security_err_revoke());
        }
      } else {
        setSessions((current) => current.filter((session) => session.id !== sessionId));
        setMessage(m.settings_security_revoked());
        // A current-session revocation invalidates the cookie server-side. Re-enter through the
        // normal auth-status wall immediately rather than leaving a visually authenticated shell
        // that will fail on its next API request.
        if (revokingCurrentSession) reloadPage();
      }
    } catch (cause) {
      console.error("SecuritySection: session revoke failed", cause);
      await reconcileUnknownRevocation(revokingCurrentSession);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title={m.settings_security_title()}
      help={m.settings_security_description()}
      testId="security-section"
      contentClassName="gap-5"
    >
      {strictProvider && (
        <div className="flex flex-col gap-2" data-testid="sso-connection">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-ink">{m.settings_sso_connect_heading()}</h3>
            {providerConnected && (
              <Badge variant="secondary">{m.settings_sso_connected({ provider: strictProvider.label })}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {m.settings_sso_connect_description({ provider: strictProvider.label })}
          </p>
          {providerConnected === false && (
            <Button size="sm" type="button" disabled={busy} onClick={() => void connectProvider()}>
              {m.settings_sso_connect_button({ provider: strictProvider.label })}
            </Button>
          )}
          <FieldError>{providerError}</FieldError>
          <Separator />
        </div>
      )}
      <form onSubmit={(event) => void changePassword(event)}>
        <FieldGroup className="gap-3">
          <h3 className="text-sm font-medium text-ink">{m.settings_security_change_password()}</h3>
          {/* All three carry the password input ceiling rather than the name-shaped default: a
              confirmation that truncated shorter than the new password could never match it. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              label={m.settings_security_current_password()}
              type="password"
              autoComplete="current-password"
              maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
              value={currentPassword}
              onChange={setCurrentPassword}
              invalid={errorField === "current"}
              describedById={errorId}
            />
            <TextField
              label={m.settings_security_new_password()}
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
              value={newPassword}
              onChange={setNewPassword}
              invalid={errorField === "new"}
              describedById={errorId}
            />
            <TextField
              label={m.settings_security_confirm_password()}
              type="password"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
              value={confirmPassword}
              onChange={setConfirmPassword}
              invalid={errorField === "confirm"}
              describedById={errorId}
            />
          </div>
          <Button size="sm" type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>
            {m.settings_security_change_password()}
          </Button>
        </FieldGroup>
      </form>

      <Separator />
      <div>
        <h3 className="text-sm font-medium text-ink">{m.settings_security_active_sessions()}</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 rounded bg-canvas p-2 text-xs">
              <span className="min-w-0 text-muted-foreground">
                <span className="block truncate text-ink">
                  {session.current ? m.settings_security_current_session() : m.settings_security_signed_in_session()}
                </span>
                {session.expiresAt
                  ? m.settings_security_session_expires({
                      created: formatInstant(session.createdAt),
                      expires: formatInstant(session.expiresAt),
                    })
                  : m.settings_security_session_no_expiry({
                      created: formatInstant(session.createdAt),
                    })}
              </span>
              <Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => void revoke(session.id)}>
                {m.settings_security_revoke()}
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <FieldError id={errorId}>{error}</FieldError>
      {message && (
        <p role="status" className="text-sm text-ok">
          {message}
        </p>
      )}
    </SettingsSection>
  );
}
