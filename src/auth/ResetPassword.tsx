import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";
import { API_BASE, isServerConfigured } from "../data/apiConfig";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field";
import { Card, CardContent } from "../components/ui/card";
import { APP_NAME } from "@capacitylens/shared/brand";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { resolveResetPasswordFailureMessage } from "./resetPasswordFailure";
import { m } from "@/i18n";
import { createRequestSignal } from "../data/requestTimeout";

// Password-reset page for /reset-password/:token. The token arrives out-of-band — an
// Owner/Admin minted it in Team & access and handed the link over directly (the app has no
// email infrastructure, a standing non-goal). This page collects the new password and POSTs Better
// Auth's PUBLIC redeem endpoint, `${API_BASE}/api/auth/reset-password` — a plain fetch, not the
// better-auth client, so this lazy chunk stays free of the auth bundle (the endpoint is one JSON
// POST; the client library adds nothing here). The server is the authority: single-use consumption,
// expiry, and password length all live there — this page only pre-checks what saves a round trip
// (mismatched confirmation, an obviously-short password) and renders the outcome.
//
// AUTH WALL: unlike /invite/:token this page must work with NO session — the visitor is exactly the
// person who CANNOT sign in. AuthProvider carves this path out of the login wall (see the
// status.kind === 'login' branch there); the redeem endpoint sits under /api/auth/*, which the
// server's requireUser preHandler already exempts.

type State = { kind: "form" } | { kind: "working" } | { kind: "done" } | { kind: "unknown" } | { kind: "local" }; // the demo build (no server) — password reset is a server-mode feature

interface ResetPasswordViewProps {
  state: State;
  password: string;
  confirm: string;
  error: string | null;
  passwordId: string;
  confirmId: string;
  errorId: string;
  setPassword: (value: string) => void;
  setConfirm: (value: string) => void;
  submit: (event: FormEvent) => void;
}

function useResetPasswordTitle() {
  useEffect(() => {
    document.title = `${m.reset_title()} · ${APP_NAME}`;
  }, []);
}

function validatePasswords(token: string | undefined, password: string, confirm: string) {
  if (!token) return m.reset_err_missing_token();
  const lengthFailure = passwordLengthFailure(password);
  if (lengthFailure === "too-short") return m.reset_err_short({ min: MIN_PASSWORD_LENGTH });
  if (lengthFailure === "too-long") return m.reset_err_long({ max: MAX_PASSWORD_LENGTH });
  if (password !== confirm) return m.reset_err_mismatch();
  return null;
}

function ResetPasswordForm(props: ResetPasswordViewProps) {
  return (
    <form onSubmit={props.submit} noValidate>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={props.passwordId}>{m.reset_new_password()}</FieldLabel>
          <Input
            id={props.passwordId}
            data-testid="reset-new-password"
            type="password"
            autoComplete="new-password"
            value={props.password}
            onChange={(event) => props.setPassword(event.target.value)}
            aria-describedby={props.error ? props.errorId : undefined}
            autoFocus
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={props.confirmId}>{m.reset_confirm_password()}</FieldLabel>
          <Input
            id={props.confirmId}
            data-testid="reset-confirm-password"
            type="password"
            autoComplete="new-password"
            value={props.confirm}
            onChange={(event) => props.setConfirm(event.target.value)}
            aria-describedby={props.error ? props.errorId : undefined}
          />
        </Field>
        <FieldError id={props.errorId}>{props.error}</FieldError>
        <div className="flex justify-end">
          <Button size="sm" type="submit" data-testid="reset-submit" disabled={props.state.kind === "working"}>
            {m.reset_submit()}
          </Button>
        </div>
        {props.state.kind === "working" && (
          <p role="status" className="text-sm text-muted-foreground">
            {m.reset_working()}
          </p>
        )}
      </FieldGroup>
    </form>
  );
}

function ResetPasswordView(props: ResetPasswordViewProps) {
  const { state } = props;
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">{m.reset_title()}</h1>
          {state.kind !== "done" && state.kind !== "local" && (
            <p className="text-sm text-muted-foreground">{m.reset_subtitle()}</p>
          )}
        </div>
        <Card className="gap-4 py-4">
          <CardContent className="px-4">
            {(state.kind === "form" || state.kind === "working") && <ResetPasswordForm {...props} />}
            {(state.kind === "done" || state.kind === "unknown") && (
              <div className="flex flex-col gap-3">
                <p role="status" data-testid="reset-success" className="text-sm font-medium text-ink">
                  {state.kind === "done" ? m.reset_success() : m.reset_unknown_outcome()}
                </p>
                <div className="flex justify-end">
                  <Button asChild size="sm">
                    <a href="/">{m.reset_go_signin()}</a>
                  </Button>
                </div>
              </div>
            )}
            {state.kind === "local" && (
              <p className="text-sm text-muted-foreground">{m.reset_local_mode({ app: APP_NAME })}</p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

/**
 * Reset-password page for `/reset-password/:token`.
 *
 * Renders a new-password + confirmation form and redeems the admin-issued single-use token against
 * Better Auth's public reset endpoint. Success offers "Go to sign in" as a FULL page load (a plain
 * anchor, not a router <Link>): there is no session, so a clean boot is what lands the visitor on
 * the login screen — client-side navigation would leave AuthProvider's boot-time status stale. In
 * the demo build (VITE_CAPACITYLENS_DEMO=1) there is no server, so it shows a short note and makes no
 * request. Surface-not-swallow: every failure path lands on a visible message.
 */
export function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>(() => (isServerConfigured() ? { kind: "form" } : { kind: "local" }));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Stable ids so both inputs can point at the shared form-level error (WCAG 3.3.1) — the
  // LoginScreen idiom: describedby re-announces the reason as the user navigates back.
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  // Per-route document.title (WCAG 2.4.2) — this route renders OUTSIDE AppShell (see router.tsx),
  // so the shell's nav-driven title effect never covers it (the InviteAccept idiom).
  useResetPasswordTitle();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const validationError = validatePasswords(token, password, confirm);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setState({ kind: "working" });
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password, token }),
        signal: createRequestSignal(),
      });
      if (res.ok) {
        setState({ kind: "done" });
        return;
      }
      // A proxy-generated timeout/5xx can arrive after the upstream consumed the one-use token and
      // changed the password. Do not reopen the form and invite a misleading retry; use the same
      // honest verification path as a transport failure.
      if (res.status === 408 || res.status >= 500) {
        setError(null);
        setState({ kind: "unknown" });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      setError(resolveResetPasswordFailureMessage(body, res.status));
      setState({ kind: "form" });
    } catch (error) {
      // A pre-response transport error (server down, DNS, offline) — surface a generic, actionable
      // message rather than a dead end, and log the real cause for debugging.
      console.error("ResetPassword: reset request failed", error);
      setError(null);
      setState({ kind: "unknown" });
    }
  };

  return (
    <ResetPasswordView
      state={state}
      password={password}
      confirm={confirm}
      error={error}
      passwordId={passwordId}
      confirmId={confirmId}
      errorId={errorId}
      setPassword={setPassword}
      setConfirm={setConfirm}
      submit={(event) => void submit(event)}
    />
  );
}
