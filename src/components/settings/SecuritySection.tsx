import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { MAX_PASSWORD_INPUT_CODE_UNITS, MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { useAuth, type AuthProviderInfo } from "@/auth/authContext";
import { m } from "@/i18n";
import { FormActions, Modal, RequiredLegend, TextField } from "../common/ui";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FieldError } from "../ui/field";
import { Separator } from "../ui/separator";
import { SettingsSection } from "./SettingsSection";
import { useSecurityController } from "./useSecurityController";
import { useProviderConnection } from "./useProviderConnection";

type Controller = ReturnType<typeof useSecurityController>;

function ProviderConnection({ provider, controller }: { provider: AuthProviderInfo; controller: Controller }) {
  const connection = useProviderConnection(provider, controller.busy, controller.setBusy);
  return (
    <div className="flex flex-col gap-2" data-testid="sso-connection">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">{m.settings_sso_connect_heading()}</h3>
        {connection.connected && (
          <Badge variant="secondary">{m.settings_sso_connected({ provider: provider.label })}</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {m.settings_sso_connect_description({ provider: provider.label })}
      </p>
      {connection.connected === false && (
        <Button size="sm" type="button" disabled={controller.busy} onClick={() => void connection.connect()}>
          {m.settings_sso_connect_button({ provider: provider.label })}
        </Button>
      )}
      <FieldError>{connection.error}</FieldError>
      <Separator />
    </div>
  );
}

function PasswordForm({ controller }: { controller: Controller }) {
  const { fieldError, password } = controller;
  return (
    <>
      <TextField
        label={m.settings_security_current_password()}
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        layout="label-control"
        maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
        value={password.currentPassword}
        onChange={password.setCurrentPassword}
        invalid={fieldError.errorField === "current"}
        describedById={fieldError.errorId}
      />
      <TextField
        label={m.settings_security_new_password()}
        type="password"
        autoComplete="new-password"
        required
        layout="label-control"
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
        value={password.newPassword}
        onChange={password.setNewPassword}
        invalid={fieldError.errorField === "new"}
        describedById={fieldError.errorId}
      />
      <TextField
        label={m.settings_security_confirm_password()}
        type="password"
        autoComplete="new-password"
        required
        layout="label-control"
        maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
        value={password.confirmPassword}
        onChange={password.setConfirmPassword}
        invalid={fieldError.errorField === "confirm"}
        describedById={fieldError.errorId}
      />
      <FieldError id={fieldError.errorId}>{fieldError.error}</FieldError>
      {controller.message && (
        <p role="status" className="text-sm text-ok">
          {controller.message}
        </p>
      )}
      <RequiredLegend />
    </>
  );
}

function MfaStatus({ enabled }: { enabled: boolean }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-ink">{m.account_mfa_title()}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {enabled ? m.account_mfa_enabled() : m.account_mfa_not_enabled()}
      </p>
    </div>
  );
}

function PasswordDialog({
  open,
  onOpenChange,
  controller,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: Controller;
}) {
  const close = () => onOpenChange(false);
  const password = controller.password;
  return (
    open && (
      <Modal
        title={m.settings_security_change_password()}
        onClose={close}
        onSubmit={() => void password.submit()}
        guardDirty={false}
        footer={
          <FormActions
            onCancel={close}
            submitLabel={m.settings_security_change_password()}
            disabled={
              controller.busy || !password.currentPassword || !password.newPassword || !password.confirmPassword
            }
          />
        }
      >
        <PasswordForm controller={controller} />
      </Modal>
    )
  );
}

function shouldShowMfa(auth: ReturnType<typeof useAuth>): boolean {
  return (
    allowsPasswordSignIn(auth.authMode) && auth.requireMfa === true && typeof auth.user?.twoFactorEnabled === "boolean"
  );
}

export function SecuritySection({
  passwordOpen = false,
  onPasswordOpenChange = () => {},
}: {
  passwordOpen?: boolean;
  onPasswordOpenChange?: (open: boolean) => void;
}) {
  const auth = useAuth();
  const providers = (auth.providers ?? []).filter(
    (provider) => !provider.experimental && (provider.id === "google" || provider.id === "microsoft"),
  );
  const controller = useSecurityController();
  const showPassword = allowsPasswordSignIn(auth.authMode) && auth.reauthMethod !== "provider";
  const changePasswordOpen = (open: boolean) => {
    if (!open) controller.password.reset();
    onPasswordOpenChange(open);
  };
  const showMfa = shouldShowMfa(auth);
  const showSection = providers.length > 0 || showMfa;
  return (
    <>
      {showSection && (
        <SettingsSection
          title={m.settings_security_title()}
          help={m.settings_security_description()}
          testId="security-section"
          contentClassName="gap-5"
        >
          {providers.map((provider) => (
            <ProviderConnection key={provider.id} provider={provider} controller={controller} />
          ))}
          {showMfa && <MfaStatus enabled={auth.user?.twoFactorEnabled === true} />}
        </SettingsSection>
      )}
      {showPassword && <PasswordDialog open={passwordOpen} onOpenChange={changePasswordOpen} controller={controller} />}
    </>
  );
}
