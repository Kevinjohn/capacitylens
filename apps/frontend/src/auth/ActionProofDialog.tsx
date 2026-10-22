import { useState } from "react";
import { API_BASE } from "@/data/apiConfig";
import { apiFetch } from "@/data/requestTimeout";
import { readApiError } from "@/lib/readApiError";
import { useAuth } from "./authContext";
import { Modal } from "@/components/common/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { m } from "@/i18n";

type Action = "transfer-ownership" | "import" | "anonymise";

interface ActionProofDialogProps {
  action: Action;
  accountId: string;
  intent: object;
  onConfirmed: (proofId: string) => void;
  onProviderStart: (proofId: string) => void;
  onCancel: () => void;
}

/** Confirms one exact action; each dialog receives only its own proof handle. */
export function ActionProofDialog({
  action,
  accountId,
  intent,
  onConfirmed,
  onProviderStart,
  onCancel,
}: ActionProofDialogProps) {
  const { reauthMethod } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const provider = reauthMethod === "provider";
      const url = `${API_BASE}/api/auth/action-proof/${provider ? "google-start" : "password"}`;
      const body = {
        action,
        accountId,
        intent,
        ...(provider
          ? {
              callbackURL: window.location.href,
              errorCallbackURL: window.location.href,
            }
          : { password }),
      };
      const response = await apiFetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError((await readApiError(response)) ?? m.reauth_failed());
        setBusy(false);
        return;
      }
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("proofId" in result) || typeof result.proofId !== "string")
        throw new Error("Action confirmation returned no proof.");
      if (provider) {
        if (!("url" in result) || typeof result.url !== "string")
          throw new Error("Provider confirmation returned no URL.");
        onProviderStart(result.proofId);
        window.location.assign(result.url);
        return;
      }
      onConfirmed(result.proofId);
    } catch (cause) {
      console.error("Action confirmation failed", cause);
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  return (
    <Modal
      title={m.reauth_title()}
      description={reauthMethod === "provider" ? m.action_proof_google_body() : m.action_proof_password_body()}
      onClose={busy ? () => {} : onCancel}
      guardDirty={false}
      footer={
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {m.form_cancel()}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {reauthMethod !== "provider" && (
          <Field>
            <FieldLabel htmlFor="action-proof-password">{m.login_password()}</FieldLabel>
            <Input
              id="action-proof-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          disabled={busy || (reauthMethod !== "provider" && !password)}
          onClick={() => void confirm()}
          data-testid="action-proof-confirm"
        >
          {busy
            ? m.ownership_transfer_working()
            : reauthMethod === "provider"
              ? m.login_continue_with({ provider: "Google" })
              : m.common_continue()}
        </Button>
      </div>
    </Modal>
  );
}
