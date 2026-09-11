import { m } from "@/i18n";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import type { FormEvent } from "react";
import { useState } from "react";
import { validateText } from "../lib/validation";
import { authClient } from "./authClient";

function validateOwnerInput({
  name,
  email,
  password,
  setError,
}: {
  name: string;
  email: string;
  password: string;
  setError: (error: string | null) => void;
}) {
  const cleanName = validateText(name, (_field, message) => setError(message), {
    field: "name",
    requiredMessage: m.identity_err_name(),
  });
  const cleanEmail = normalizeAccountEmail(email);
  if (cleanName === null) return null;
  if (!isAccountEmail(cleanEmail)) {
    setError(m.identity_err_email());
    return null;
  }
  if (passwordLengthFailure(password)) {
    setError(m.identity_err_password({ min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH }));
    return null;
  }
  return { cleanName, cleanEmail };
}

const SETUP_TOKEN_HEADER = "x-capacitylens-setup-token";

/**
 * Keep the setup token safe for the browser's HTTP header implementation. Operators commonly
 * paste a token with ordinary edge whitespace; trim that harmless formatting, but reject values
 * containing characters that the request headers cannot represent before Better Auth constructs
 * the request. The comparison also catches header implementations that silently rewrite a value.
 */
export function normalizeSetupToken(value: string): string | null {
  const normalized = value.trim();
  // Fetch may silently strip CR/LF and accepts some other C0 bytes in a Headers value. Reject all
  // control characters explicitly so the token is never changed between validation and sending.
  if (
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (codePoint >= 0 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f);
    })
  )
    return null;
  try {
    const headers = new Headers({ [SETUP_TOKEN_HEADER]: normalized });
    return headers.get(SETUP_TOKEN_HEADER) === normalized ? normalized : null;
  } catch {
    return null;
  }
}

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
    const input = validateOwnerInput({ name, email, password, setError });
    if (!input) return;
    const cleanSetupToken = normalizeSetupToken(setupToken);
    if (cleanSetupToken === null) {
      setError(m.login_setup_token_invalid());
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Better Auth auto-signs-in on sign-up, so success proceeds exactly like a sign-in:
      // onSignedIn() reloads and the boot re-check finds the fresh session cookie.
      const { error: failure } = await authClient.signUp.email({
        email: input.cleanEmail,
        password,
        name: input.cleanName,
        fetchOptions: { headers: { [SETUP_TOKEN_HEADER]: cleanSetupToken } },
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
    } catch {
      // Same contract as the sign-in path: a THROW is a pre-response network/transport error —
      // surface a generic message + reset busy so the button never sticks disabled. Record the
      // operation without the caught value because transport metadata may retain the secret header.
      console.error("LoginScreen: owner-setup sign-up request failed");
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  return { name, setName, setupToken, setSetupToken, setupClosed, createOwner };
}
