import { useId, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Modal } from "../components/common/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Field, FieldError, FieldLabel } from "../components/ui/field";
import { authClient } from "./authClient";
import { m } from "@/i18n";
import type { AuthProviderInfo, AuthUser } from "./authContext";
import { completeReauth } from "./reauthCoordinator";
import type { ReauthAction } from "./reauthCoordinator";
import { dispatchExternalProviderSignIn } from "./externalProviderSignIn";

interface ReauthDialogProps {
  authMode: "password" | "sso";
  user: AuthUser | null;
  providers: AuthProviderInfo[];
  reauthMethod?: "password" | "provider";
  reauthProviderId?: string | null;
  action?: ReauthAction | null;
}

interface ReauthState {
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  twoFactorPending: boolean;
  setTwoFactorPending: Dispatch<SetStateAction<boolean>>;
  code: string;
  setCode: Dispatch<SetStateAction<string>>;
  useRecoveryCode: boolean;
  setUseRecoveryCode: Dispatch<SetStateAction<boolean>>;
  errorId: string;
}

function useReauthState(): ReauthState {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  return {
    password,
    setPassword,
    error,
    setError,
    busy,
    setBusy,
    twoFactorPending,
    setTwoFactorPending,
    code,
    setCode,
    useRecoveryCode,
    setUseRecoveryCode,
    errorId: useId(),
  };
}

function hasTwoFactorRedirect(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && "twoFactorRedirect" in value && value.twoFactorRedirect === true
  );
}

async function confirmPassword(email: string, state: ReauthState) {
  if (state.busy) return;
  if (!email) {
    state.setError(m.reauth_failed());
    return;
  }
  state.setBusy(true);
  state.setError(null);
  try {
    const { data, error } = await authClient.signIn.email({ email, password: state.password });
    if (error) {
      state.setError(error.message ?? m.reauth_failed());
      state.setBusy(false);
      return;
    }
    if (hasTwoFactorRedirect(data)) {
      state.setTwoFactorPending(true);
      state.setBusy(false);
      return;
    }
    completeReauth(true);
  } catch (error) {
    console.error("ReauthDialog: password re-auth request failed", error);
    state.setError(m.login_network_error());
    state.setBusy(false);
  }
}

async function confirmSecondFactor(state: ReauthState) {
  if (state.busy) return;
  state.setBusy(true);
  state.setError(null);
  try {
    const result = state.useRecoveryCode
      ? await authClient.twoFactor.verifyBackupCode({ code: state.code, trustDevice: false })
      : await authClient.twoFactor.verifyTotp({ code: state.code, trustDevice: false });
    if (result.error) {
      state.setError(result.error.message ?? m.reauth_failed());
      state.setBusy(false);
      return;
    }
    completeReauth(true);
  } catch (error) {
    console.error("ReauthDialog: second-factor re-auth verification failed", error);
    state.setError(m.login_network_error());
    state.setBusy(false);
  }
}

async function reauthWithProvider(provider: AuthProviderInfo, state: ReauthState) {
  if (state.busy) return;
  state.setBusy(true);
  state.setError(null);
  try {
    const result = await dispatchExternalProviderSignIn(provider);
    state.setError(result.error?.message ?? m.reauth_failed());
    state.setBusy(false);
  } catch (error) {
    console.error("ReauthDialog: SSO re-auth request failed", error);
    state.setError(m.login_network_error());
    state.setBusy(false);
  }
}

export function ReauthDialog({
  authMode,
  user,
  providers,
  reauthMethod = authMode === "sso" ? "provider" : "password",
  reauthProviderId = null,
  action = null,
}: ReauthDialogProps) {
  const state = useReauthState();
  const cancel = () => completeReauth(false);
  if (reauthMethod === "provider") {
    const selected = reauthProviderId ? providers.filter((provider) => provider.id === reauthProviderId) : providers;
    return <ProviderDialog providers={selected} state={state} cancel={cancel} action={action} />;
  }
  if (state.twoFactorPending) return <SecondFactorDialog state={state} cancel={cancel} action={action} />;
  return (
    <PasswordDialog
      state={state}
      cancel={cancel}
      confirm={() => void confirmPassword(user?.email ?? "", state)}
      action={action}
    />
  );
}

function ProviderDialog({
  providers,
  state,
  cancel,
  action,
}: {
  providers: AuthProviderInfo[];
  state: ReauthState;
  cancel: () => void;
  action: ReauthAction | null | undefined;
}) {
  return (
    <Modal
      title={action ? `${m.reauth_title()} — ${reauthActionLabel(action)}` : m.reauth_title()}
      onClose={() => {
        if (!state.busy) cancel();
      }}
      guardDirty={false}
      footer={<CancelButton busy={state.busy} cancel={cancel} />}
    >
      <p className="text-sm text-muted-foreground">{m.reauth_body_sso()}</p>
      <FieldError>{state.error ?? (providers.length === 0 ? m.login_sso_unavailable() : null)}</FieldError>
      {providers.length > 0 ? (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => (
            <Button
              size="sm"
              key={`${provider.kind}:${provider.id}`}
              variant="outline"
              onClick={() => void reauthWithProvider(provider, state)}
              disabled={state.busy}
            >
              {m.login_continue_with({ provider: provider.label })}
            </Button>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

function SecondFactorDialog({
  state,
  cancel,
  action,
}: {
  state: ReauthState;
  cancel: () => void;
  action: ReauthAction | null | undefined;
}) {
  return (
    <Modal
      title={action ? `${m.reauth_title()} — ${reauthActionLabel(action)}` : m.reauth_title()}
      onClose={() => {
        if (!state.busy) cancel();
      }}
      onSubmit={() => void confirmSecondFactor(state)}
      guardDirty={false}
      footer={
        <>
          <CancelButton busy={state.busy} cancel={cancel} />
          <Button size="sm" type="submit" data-testid="reauth-2fa-submit" disabled={state.busy || !state.code}>
            {m.reauth_2fa_submit()}
          </Button>
        </>
      }
    >
      <SecondFactorFields state={state} />
    </Modal>
  );
}

function SecondFactorFields({ state }: { state: ReauthState }) {
  const toggleRecovery = () => {
    state.setUseRecoveryCode((value) => !value);
    state.setCode("");
    state.setError(null);
  };
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {state.useRecoveryCode ? m.reauth_2fa_recovery_body() : m.reauth_2fa_body()}
      </p>
      <Field>
        <FieldLabel htmlFor="reauth-2fa-code">
          {state.useRecoveryCode ? m.reauth_2fa_recovery_label() : m.reauth_2fa_label()}
        </FieldLabel>
        <Input
          id="reauth-2fa-code"
          data-testid="reauth-2fa-code"
          type="text"
          inputMode={state.useRecoveryCode ? "text" : "numeric"}
          autoComplete="one-time-code"
          value={state.code}
          onChange={(event) => state.setCode(event.target.value.trim())}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? state.errorId : undefined}
          autoFocus
        />
      </Field>
      <FieldError id={state.errorId}>{state.error}</FieldError>
      <Button size="sm" type="button" variant="outline" disabled={state.busy} onClick={toggleRecovery}>
        {state.useRecoveryCode ? m.reauth_2fa_use_authenticator() : m.reauth_2fa_use_recovery()}
      </Button>
    </>
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
  "delete-company": () => m.reauth_action_delete_company(),
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
  "lifecycle-delete": () => m.reauth_action_lifecycle_delete(),
  "lifecycle-purge": () => m.reauth_action_lifecycle_purge(),
};

function reauthActionLabel(action: ReauthAction): string {
  return reauthActionLabels[action]();
}
