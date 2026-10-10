import { m } from "@/i18n";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_PASSWORD_INPUT_CODE_UNITS } from "@capacitylens/shared/domain/password";
import type { FormEvent } from "react";
import { useState } from "react";
import { authClient } from "./authClient";

export function usePasswordSignIn({
  setError,
  setBusy,
  onSignedIn,
}: {
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
  onSignedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signInWithPassword = async (e: FormEvent) => {
    e.preventDefault();
    const normalizedEmail = normalizeAccountEmail(email);
    if (!isAccountEmail(normalizedEmail)) {
      setError(m.identity_err_email());
      return;
    }
    if (password.length > MAX_PASSWORD_INPUT_CODE_UNITS) {
      setError(m.login_password_input_too_long());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await authClient.signIn.email({
        email: normalizedEmail,
        password,
      });
      if (failure) {
        setError(failure.message ?? m.login_failed());
        setBusy(false);
        return;
      }
      onSignedIn();
    } catch (error) {
      // Better Auth returns an auth failure as { error } (handled above). A throw here is a
      // pre-response network/transport error, without this catch `busy` stayed true forever (button
      // stuck disabled, no message). Surface a generic message + reset busy; log the real cause.
      console.error("LoginScreen: password sign-in request failed", error);
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  return { email, setEmail, password, setPassword, signInWithPassword };
}
