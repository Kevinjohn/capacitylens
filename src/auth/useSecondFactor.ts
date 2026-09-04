import { m } from "@/i18n";
import type { FormEvent } from "react";
import { useState } from "react";
import { authClient } from "./authClient";

export function useSecondFactor({
  setError,
  setBusy,
  onSignedIn,
}: {
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
  onSignedIn: () => void;
}) {
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const verifySecondFactor = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = useRecoveryCode
        ? await authClient.twoFactor.verifyBackupCode({
            code: twoFactorCode,
            trustDevice: false,
          })
        : await authClient.twoFactor.verifyTotp({
            code: twoFactorCode,
            trustDevice: false,
          });
      if (result.error) {
        setError(result.error.message ?? m.login_failed());
        setBusy(false);
        return;
      }
      onSignedIn();
    } catch (err) {
      console.error("LoginScreen: second-factor verification failed", err);
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  return {
    twoFactorPending,
    setTwoFactorPending,
    twoFactorCode,
    setTwoFactorCode,
    useRecoveryCode,
    setUseRecoveryCode,
    verifySecondFactor,
  };
}
