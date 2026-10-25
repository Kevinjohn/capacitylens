import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";
import { APP_NAME } from "@capacitylens/shared/brand";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { m } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { authClient } from "./authClient";

type State = "checking" | "form" | "working" | "done" | "invalid";

/**
 * Spends an emailed address-confirmation link. Confirming also sets the password the person
 * chooses here, because holding the link already proves control of the mailbox. Completion ends
 * every sign-in, so the page returns to sign-in through a full reload.
 */
export function VerifyEmail() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>(token ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const passwordId = useId();
  const errorId = useId();

  useEffect(() => {
    document.title = `${m.verify_title()} · ${APP_NAME}`;
  }, []);

  useEffect(() => {
    if (!token) return;
    let current = true;
    authClient
      .inspectEmailVerification(token)
      .then(({ data }) => {
        if (current) setState(data?.valid ? "form" : "invalid");
      })
      .catch((failure: unknown) => {
        console.warn("VerifyEmail: link inspection failed", failure);
        if (current) setState("invalid");
      });
    return () => {
      current = false;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    const lengthFailure = passwordLengthFailure(password);
    if (lengthFailure) {
      setError(
        lengthFailure === "too-short"
          ? m.reset_err_short({ min: MIN_PASSWORD_LENGTH })
          : m.reset_err_long({ max: MAX_PASSWORD_LENGTH }),
      );
      return;
    }
    setError(null);
    setState("working");
    try {
      const { error: failure } = await authClient.completeEmailVerification({ token, password });
      if (!failure) setState("done");
      else if (failure.code === "INVALID_TOKEN") setState("invalid");
      else {
        setError(failure.message || m.verify_failed());
        setState("form");
      }
    } catch (failure) {
      console.error("VerifyEmail: confirmation failed", failure);
      setError(m.verify_failed());
      setState("form");
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">{m.verify_title()}</h1>
        </div>
        <Card className="gap-4 py-4">
          <CardContent className="flex flex-col gap-3 px-4">
            {state === "checking" && (
              <p role="status" className="text-sm text-muted-foreground">
                {m.verify_checking()}
              </p>
            )}
            {state === "invalid" && (
              <p role="alert" data-testid="verify-invalid" className="text-sm">
                {m.verify_invalid()}
              </p>
            )}
            {(state === "form" || state === "working") && (
              <form onSubmit={(event) => void submit(event)} noValidate>
                <FieldGroup className="gap-3">
                  <p className="text-sm text-muted-foreground">{m.verify_intro()}</p>
                  <Field>
                    <FieldLabel htmlFor={passwordId}>{m.reset_new_password()}</FieldLabel>
                    <Input
                      id={passwordId}
                      data-testid="verify-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      aria-describedby={error ? errorId : undefined}
                      autoFocus
                    />
                  </Field>
                  <FieldError id={errorId}>{error}</FieldError>
                  <div className="flex justify-end">
                    <Button size="sm" type="submit" data-testid="verify-submit" disabled={state === "working"}>
                      {m.verify_submit()}
                    </Button>
                  </div>
                </FieldGroup>
              </form>
            )}
            {(state === "done" || state === "invalid") && (
              <>
                {state === "done" && (
                  <p role="status" data-testid="verify-success" className="text-sm font-medium text-ink">
                    {m.verify_done()}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button asChild size="sm">
                    <a href="/">{m.verify_go_signin()}</a>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
