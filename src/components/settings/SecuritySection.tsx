import { useCallback, useEffect, useId, useState } from "react";
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
import { Input } from "../ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Separator } from "../ui/separator";

interface SessionView {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  current: boolean;
}

type PasswordErrorField = "current" | "new" | "confirm";

export function SecuritySection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordErrorField, setPasswordErrorField] = useState<PasswordErrorField | null>(null);
  const errorId = useId();

  const loadSessions = useCallback(async (): Promise<"loaded" | "unauthorized" | "failed"> => {
    try {
      const response = await accountClient.listSessions();
      const body: unknown = await response.json().catch(() => null);
      const rows =
        body &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        Array.isArray((body as { sessions?: unknown }).sessions)
          ? (body as { sessions: unknown[] }).sessions
          : null;
      if (!response.ok || rows === null) {
        setError(m.settings_security_err_sessions_load());
        return response.status === 401 ? "unauthorized" : "failed";
      }
      const valid = rows.filter((value): value is SessionView => {
        if (!value || typeof value !== "object") return false;
        const row = value as Partial<SessionView>;
        return (
          typeof row.id === "string" &&
          /^[A-Za-z0-9_-]{16,128}$/.test(row.id) &&
          typeof row.createdAt === "string" &&
          Number.isFinite(Date.parse(row.createdAt)) &&
          (row.expiresAt === null ||
            (typeof row.expiresAt === "string" && Number.isFinite(Date.parse(row.expiresAt)))) &&
          typeof row.current === "boolean"
        );
      });
      if (valid.length !== rows.length) {
        setError(m.settings_security_err_sessions_invalid());
        return "failed";
      }
      setSessions(valid);
      setError(null);
      return "loaded";
    } catch (cause) {
      console.error("SecuritySection: session list failed", cause);
      setError(m.settings_security_err_sessions_load());
      return "failed";
    }
  }, []);

  useEffect(() => {
    // The state changes happen only after the external session request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSessions();
  }, [loadSessions]);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPasswordErrorField(null);
    setMessage(null);
    if (passwordLengthFailure(newPassword)) {
      setPasswordErrorField("new");
      setError(
        m.settings_security_err_password_length({
          min: MIN_PASSWORD_LENGTH,
          max: MAX_PASSWORD_LENGTH,
        }),
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordErrorField("confirm");
      setError(m.settings_security_err_password_mismatch());
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
        setPasswordErrorField("current");
        setError(result.error.message ?? m.settings_security_err_password_change());
      } else {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setMessage(m.settings_security_password_changed());
        await loadSessions();
      }
    } catch (cause) {
      console.error("SecuritySection: password change failed", cause);
      setPasswordErrorField("current");
      setError(m.settings_security_err_auth_unavailable());
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (sessionId: string) => {
    const revokingCurrentSession = sessions.some((session) => session.id === sessionId && session.current);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await accountClient.revokeOwnSession(sessionId);
      if (!response.ok) {
        if (await accountCommandOutcomeUnknown(response)) {
          // The server may have committed before a proxy/worker failure obscured the response.
          // If this is the current session, tenant data must leave the screen immediately because
          // no follow-up response can prove that the browser cookie survived. Other sessions can
          // be reconciled through an authoritative list refresh.
          if (revokingCurrentSession || response.status === 401) {
            window.location.reload();
            return;
          }
          const refreshOutcome = await loadSessions();
          if (refreshOutcome === "unauthorized") {
            window.location.reload();
            return;
          }
          setMessage(
            refreshOutcome === "loaded"
              ? m.settings_security_revoke_unknown_refreshed()
              : m.settings_security_revoke_unknown_unavailable(),
          );
        } else {
          setError(m.settings_security_err_revoke());
        }
      } else {
        setSessions((current) => current.filter((session) => session.id !== sessionId));
        setMessage(m.settings_security_revoked());
        // A current-session revocation invalidates the cookie server-side. Re-enter through the
        // normal auth-status wall immediately rather than leaving a visually authenticated shell
        // that will fail on its next API request.
        if (revokingCurrentSession) window.location.reload();
      }
    } catch (cause) {
      console.error("SecuritySection: session revoke failed", cause);
      if (revokingCurrentSession) {
        window.location.reload();
        return;
      }
      const refreshOutcome = await loadSessions();
      if (refreshOutcome === "unauthorized") {
        window.location.reload();
        return;
      }
      setMessage(
        refreshOutcome === "loaded"
          ? m.settings_security_revoke_unknown_refreshed()
          : m.settings_security_revoke_unknown_unavailable(),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="security-section">
      <CardHeader>
        <CardTitle>
          <h2>{m.settings_security_title()}</h2>
        </CardTitle>
        <CardDescription>{m.settings_security_description()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={(event) => void changePassword(event)}>
          <FieldGroup className="gap-3">
            <h3 className="text-sm font-medium text-ink">{m.settings_security_change_password()}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="security-current-password">{m.settings_security_current_password()}</FieldLabel>
                <Input
                  id="security-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  aria-invalid={passwordErrorField === "current" || undefined}
                  aria-describedby={passwordErrorField === "current" ? errorId : undefined}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="security-new-password">{m.settings_security_new_password()}</FieldLabel>
                <Input
                  id="security-new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  aria-invalid={passwordErrorField === "new" || undefined}
                  aria-describedby={passwordErrorField === "new" ? errorId : undefined}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="security-confirm-password">{m.settings_security_confirm_password()}</FieldLabel>
                <Input
                  id="security-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  aria-invalid={passwordErrorField === "confirm" || undefined}
                  aria-describedby={passwordErrorField === "confirm" ? errorId : undefined}
                />
              </Field>
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
                        created: new Date(session.createdAt).toLocaleString(),
                        expires: new Date(session.expiresAt).toLocaleString(),
                      })
                    : m.settings_security_session_no_expiry({
                        created: new Date(session.createdAt).toLocaleString(),
                      })}
                </span>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void revoke(session.id)}
                >
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
      </CardContent>
    </Card>
  );
}
