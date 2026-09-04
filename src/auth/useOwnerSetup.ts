import { m } from "@/i18n";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import type { FormEvent } from "react";
import { useState } from "react";
import { validateText } from "../lib/validation";
import { authClient } from "./authClient";

export function useOwnerSetup({
  email,
  password,
  setError,
  setBusy,
  onSignedIn,
}: {
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
  onSignedIn: () => void;
  email: string;
  password: string;
}) {
  const [name, setName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  // Flips true the moment OUR owner-setup submit is refused because someone else's setup
  // already won the race (server's live per-request gate — see server/src/auth.ts). needsSetup
  // is a one-time snapshot from page load, so a second tab/operator can still see the create-owner
  // form after the workspace is bootstrapped; this local override forces the ordinary sign-in
  // form instead of leaving the loser stuck on a dead-end create-owner form. Never flips back.
  const [setupClosed, setSetupClosed] = useState(false);
  const createOwner = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = validateText(name, (_field, message) => setError(message), {
      field: "name",
      requiredMessage: m.identity_err_name(),
    });
    if (cleanName === null) return;
    const cleanEmail = normalizeAccountEmail(email);
    if (!isAccountEmail(cleanEmail)) {
      setError(m.identity_err_email());
      return;
    }
    if (passwordLengthFailure(password)) {
      setError(
        m.identity_err_password({
          min: MIN_PASSWORD_LENGTH,
          max: MAX_PASSWORD_LENGTH,
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Better Auth auto-signs-in on sign-up, so success proceeds exactly like a sign-in:
      // onSignedIn() reloads and the boot re-check finds the fresh session cookie.
      const { error: failure } = await authClient.signUp.email({
        email: cleanEmail,
        password,
        name: cleanName,
        fetchOptions: { headers: { "x-capacitylens-setup-token": setupToken } },
      });
      if (failure) {
        // The live per-request gate (server/src/auth.ts) closes the instant a user exists, so a
        // second tab/operator racing our own first-run setup gets refused with this EXACT typed
        // code — Better Auth's disableSignUp shape, reused verbatim by our hook. That's the ONE
        // failure that isn't really "your input was wrong": someone else already finished setup,
        // so drop out of setup mode into ordinary sign-in rather than leave the loser stuck on a
        // dead-end create-owner form with no recovery but a manual reload.
        if (failure.code === "EMAIL_PASSWORD_SIGN_UP_DISABLED") {
          setError(m.login_setup_taken());
          setSetupClosed(true);
          setBusy(false);
          return;
        }
        // Any other reason (e.g. password too short) — surface Better Auth's own message; a
        // generic message would hide the fix.
        setError(failure.message ?? m.login_setup_failed());
        setBusy(false);
        return;
      }
      onSignedIn();
    } catch (err) {
      // Same contract as the sign-in path: a THROW is a pre-response network/transport error —
      // surface a generic message + reset busy so the button never sticks disabled; log the cause.
      console.error("LoginScreen: owner-setup sign-up request failed", err);
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  return { name, setName, setupToken, setSetupToken, setupClosed, createOwner };
}
