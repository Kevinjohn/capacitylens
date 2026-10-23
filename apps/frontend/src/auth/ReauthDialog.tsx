import { useId, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Modal } from "@/components/common/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { authClient } from "./authClient";
import { m } from "@/i18n";
import { MAX_PASSWORD_INPUT_CODE_UNITS } from "@capacitylens/shared/domain/password";
import type { AuthUser } from "./authContext";
import { completeReauth } from "./reauthCoordinator";
import type { ReauthAction } from "./reauthCoordinator";

interface ReauthDialogProps {
  user: AuthUser | null;
  action?: ReauthAction | null;
}

interface ReauthState {
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  errorId: string;
}

function useReauthState(): ReauthState {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    password,
    setPassword,
    error,
    setError,
    busy,
    setBusy,
    errorId: useId(),
  };
}

async function confirmPassword(email: string, state: ReauthState) {
  if (state.busy) return;
  if (!email) {
    state.setError(m.reauth_failed());
    return;
  }
  if (state.password.length > MAX_PASSWORD_INPUT_CODE_UNITS) {
    state.setError(m.reauth_failed());
    return;
  }
  state.setBusy(true);
  state.setError(null);
  try {
    const { error } = await authClient.signIn.email({ email, password: state.password });
    if (error) {
      state.setError(error.message);
      state.setBusy(false);
      return;
    }
    completeReauth({ reauthenticated: true });
  } catch (error) {
    // Log the transport cause and release busy state so failed re-authentication does not strand waiting controls.
    console.error("ReauthDialog: password re-auth request failed", error);
    state.setError(m.login_network_error());
    state.setBusy(false);
  }
}

/** Prompts for fresh authentication before a protected account action continues. */
export function ReauthDialog({ user, action = null }: ReauthDialogProps) {
  const state = useReauthState();
  const cancel = () => completeReauth({ reauthenticated: false });
  return (
    <PasswordDialog
      state={state}
      cancel={cancel}
      confirm={() => void confirmPassword(user?.email ?? "", state)}
      action={action}
    />
  );
}

function PasswordDialog({
  state,
  cancel,
  confirm,
  action,
}: {
  state: ReauthState;
  cancel: () => void;
  confirm: () => void;
  action: ReauthAction | null | undefined;
}) {
  return (
    <Modal
      title={action ? `${m.reauth_title()} — ${reauthActionLabel(action)}` : m.reauth_title()}
      onClose={() => {
        if (!state.busy) cancel();
      }}
      onSubmit={confirm}
      guardDirty={false}
      footer={
        <>
          <CancelButton busy={state.busy} cancel={cancel} />
          <Button size="sm" type="submit" data-testid="reauth-submit" disabled={state.busy}>
            {m.reauth_submit()}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{m.reauth_body()}</p>
      <Field>
        <FieldLabel htmlFor="reauth-password">{m.login_password()}</FieldLabel>
        <Input
          id="reauth-password"
          data-testid="reauth-password"
          type="password"
          autoComplete="current-password"
          value={state.password}
          onChange={(event) => state.setPassword(event.target.value)}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? state.errorId : undefined}
          autoFocus
        />
      </Field>
      <FieldError id={state.errorId}>{state.error}</FieldError>
    </Modal>
  );
}

function CancelButton({ busy, cancel }: { busy: boolean; cancel: () => void }) {
  return (
    <Button size="sm" type="button" variant="outline" onClick={cancel} disabled={busy}>
      {m.form_cancel()}
    </Button>
  );
}

const reauthActionLabels: Record<ReauthAction, () => string> = {
  "connect-provider": () => m.reauth_action_connect_provider(),
  "correct-member-email": () => m.reauth_action_correct_member_email(),
  "remove-federated-link": () => m.reauth_action_remove_federated_link(),
  "change-sign-in-tracking": () => m.reauth_action_change_sign_in_tracking(),
  "change-member-role": () => m.reauth_action_change_member_role(),
  "change-member-status": () => m.reauth_action_change_member_status(),
  "remove-member": () => m.reauth_action_remove_member(),
  "transfer-ownership": () => m.reauth_action_transfer_ownership(),
  "issue-password-reset": () => m.reauth_action_issue_password_reset(),
  "revoke-member-sessions": () => m.reauth_action_revoke_member_sessions(),
  "create-invitation": () => m.reauth_action_create_invitation(),
  "revoke-invitation": () => m.reauth_action_revoke_invitation(),
  "lifecycle-archive": () => m.reauth_action_lifecycle_archive(),
  "lifecycle-restore": () => m.reauth_action_lifecycle_restore(),
};

function reauthActionLabel(action: ReauthAction): string {
  return reauthActionLabels[action]();
}
