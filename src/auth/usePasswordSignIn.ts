import { m } from "@/i18n";
import type { FormEvent } from "react";
import { useState } from "react";
import { authClient } from "./authClient";

export function usePasswordSignIn({
  setError,
  setBusy,
  onSignedIn,
  setTwoFactorPending,
}: {
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
  onSignedIn: () => void;
  setTwoFactorPending: (pending: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signInWithPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data, error: failure } = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });
      if (failure) {
        setError(failure.message ?? m.login_failed());
        setBusy(false);
        return;
      }
      if ((data as { twoFactorRedirect?: unknown } | null)?.twoFactorRedirect === true) {
        setTwoFactorPending(true);
        setBusy(false);
        return;
      }
      onSignedIn();
    } catch (err) {
      // Better Auth returns an auth FAILURE as { error } (handled above). A THROW here is a
      // pre-response network/transport error — without this catch `busy` stayed true forever (button
      // stuck disabled, no message). Surface a generic message + reset busy; log the real cause.
      console.error("LoginScreen: password sign-in request failed", err);
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  return { email, setEmail, password, setPassword, signInWithPassword };
}
