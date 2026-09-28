import { useId, useState, type FormEvent } from "react";
import { m } from "@/i18n";
import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { API_BASE } from "../data/apiConfig";
import { createRequestSignal } from "../data/requestTimeout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Field, FieldError, FieldLabel } from "../components/ui/field";

/** Optional self-service recovery; success never reveals whether an address is registered. */
export function ForgotPassword() {
  const [phase, setPhase] = useState<"closed" | "form" | "sent">("closed");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const errorId = useId();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/auth/request-password-reset`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizeAccountEmail(email) }),
        signal: createRequestSignal(),
      });
      if (response.ok) setPhase("sent");
      else setError(m.login_failed());
    } catch {
      setError(m.login_network_error());
    } finally {
      setBusy(false);
    }
  };
  if (phase === "sent")
    return (
      <p className="mt-3 text-sm" role="status" data-testid="forgot-password-confirmation">
        {m.login_reset_confirmation()}
      </p>
    );
  if (phase === "closed")
    return (
      <Button
        className="mt-3"
        variant="link"
        type="button"
        data-testid="forgot-password"
        onClick={() => setPhase("form")}
      >
        {m.login_forgot_password()}
      </Button>
    );
  return (
    <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <Field>
        <FieldLabel htmlFor={emailId}>{m.login_email()}</FieldLabel>
        <Input
          id={emailId}
          data-testid="forgot-password-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby={error ? errorId : undefined}
        />
      </Field>
      {error && (
        <FieldError id={errorId} role="alert">
          {error}
        </FieldError>
      )}
      <Button type="submit" data-testid="forgot-password-submit" disabled={busy}>
        {m.login_send_reset_link()}
      </Button>
    </form>
  );
}
