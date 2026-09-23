import { useRef, useState } from "react";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { authClient } from "@/auth/authClient";
import { useFieldError } from "@/hooks/useFieldError";
import { m } from "@/i18n";

type Fail = ReturnType<typeof useFieldError>["fail"];

interface PasswordChangeInput {
  fail: Fail;
  clear: () => void;
  setMessage: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
}

function usePasswordChange({ fail, clear, setMessage, setBusy }: PasswordChangeInput) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const generation = useRef(0);

  const reset = () => {
    generation.current += 1;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    clear();
    setMessage(null);
  };

  const submit = async () => {
    clear();
    setMessage(null);
    if (passwordLengthFailure(newPassword)) {
      fail("new", m.settings_security_err_password_length({ min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) return fail("confirm", m.settings_security_err_password_mismatch());
    const requestGeneration = ++generation.current;
    setBusy(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (requestGeneration !== generation.current) return;
      if (result.error) return fail("current", result.error.message ?? m.settings_security_err_password_change());
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(m.settings_security_password_changed());
    } catch (cause) {
      console.error("SecuritySection: password change failed", cause);
      if (requestGeneration === generation.current) fail("current", m.settings_security_err_auth_unavailable());
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
    reset,
    submit,
  };
}

export function useSecurityController() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fieldError = useFieldError();
  const password = usePasswordChange({
    fail: fieldError.fail,
    clear: fieldError.clear,
    setMessage,
    setBusy,
  });

  return { busy, setBusy, message, fieldError, password };
}
