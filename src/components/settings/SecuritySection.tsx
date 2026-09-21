import { MAX_PASSWORD_INPUT_CODE_UNITS, MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { resolveStrictOidcProvider, useAuth } from "@/auth/authContext";
import { m } from "@/i18n";
import { TextField } from "../common/fields";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FieldError, FieldGroup } from "../ui/field";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Separator } from "../ui/separator";
import { SettingsSection } from "./SettingsSection";
import { useSecurityController } from "./useSecurityController";

type Controller = ReturnType<typeof useSecurityController>;

function ProviderConnection({
  provider,
  controller,
}: {
  provider: NonNullable<ReturnType<typeof resolveStrictOidcProvider>>;
  controller: Controller;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="sso-connection">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">{m.settings_sso_connect_heading()}</h3>
        {controller.provider.connected && (
          <Badge variant="secondary">{m.settings_sso_connected({ provider: provider.label })}</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {m.settings_sso_connect_description({ provider: provider.label })}
      </p>
      {controller.provider.connected === false && (
        <Button size="sm" type="button" disabled={controller.busy} onClick={() => void controller.provider.connect()}>
          {m.settings_sso_connect_button({ provider: provider.label })}
        </Button>
      )}
      <FieldError>{controller.provider.error}</FieldError>
      <Separator />
    </div>
  );
}

function PasswordForm({ controller }: { controller: Controller }) {
  const { fieldError, password } = controller;
  return (
    <form onSubmit={(event) => void password.submit(event)}>
      <FieldGroup className="gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label={m.settings_security_current_password()}
            type="password"
            autoComplete="current-password"
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
            maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
            value={password.confirmPassword}
            onChange={password.setConfirmPassword}
            invalid={fieldError.errorField === "confirm"}
            describedById={fieldError.errorId}
          />
        </div>
        <Button
          size="sm"
          type="submit"
          disabled={controller.busy || !password.currentPassword || !password.newPassword || !password.confirmPassword}
        >
          {m.settings_security_change_password()}
        </Button>
      </FieldGroup>
    </form>
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{m.settings_security_change_password()}</DialogTitle>
        <DialogDescription>{m.settings_security_description()}</DialogDescription>
        <PasswordForm controller={controller} />
        <FieldError id={controller.fieldError.errorId}>{controller.fieldError.error}</FieldError>
        {controller.message && (
          <p role="status" className="text-sm text-ok">
            {controller.message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function shouldShowMfa(auth: ReturnType<typeof useAuth>): boolean {
  return auth.authMode === "password" && auth.requireMfa === true && typeof auth.user?.twoFactorEnabled === "boolean";
}

export function SecuritySection({
  passwordOpen = false,
  onPasswordOpenChange = () => {},
}: {
  passwordOpen?: boolean;
  onPasswordOpenChange?: (open: boolean) => void;
}) {
  const auth = useAuth();
  const strictProvider = resolveStrictOidcProvider(auth.providers);
  const controller = useSecurityController(strictProvider);
  const showPassword = auth.authMode === "password" && auth.reauthMethod !== "provider";
  const changePasswordOpen = (open: boolean) => {
    if (!open) controller.password.reset();
    onPasswordOpenChange(open);
  };
  const showMfa = shouldShowMfa(auth);
  const showSection = strictProvider !== undefined || showMfa;
  return (
    <>
      {showSection && (
        <SettingsSection
          title={m.settings_security_title()}
          help={m.settings_security_description()}
          testId="security-section"
          contentClassName="gap-5"
        >
          {strictProvider && <ProviderConnection provider={strictProvider} controller={controller} />}
          {showMfa && <MfaStatus enabled={auth.user?.twoFactorEnabled === true} />}
        </SettingsSection>
      )}
      {showPassword && <PasswordDialog open={passwordOpen} onOpenChange={changePasswordOpen} controller={controller} />}
    </>
  );
}
