import { MAX_PASSWORD_INPUT_CODE_UNITS, MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { resolveStrictOidcProvider, useAuth } from "@/auth/authContext";
import { m } from "@/i18n";
import { formatInstant } from "@/lib/dateDisplay";
import { TextField } from "../common/fields";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FieldError, FieldGroup } from "../ui/field";
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
        <h3 className="text-sm font-medium text-ink">{m.settings_security_change_password()}</h3>
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

function SessionList({ controller }: { controller: Controller }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-ink">{m.settings_security_active_sessions()}</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {controller.sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between gap-3 rounded bg-canvas p-2 text-xs">
            <span className="min-w-0 text-muted-foreground">
              <span className="block truncate text-ink">
                {session.current ? m.settings_security_current_session() : m.settings_security_signed_in_session()}
              </span>
              {session.expiresAt
                ? m.settings_security_session_expires({
                    created: formatInstant(session.createdAt),
                    expires: formatInstant(session.expiresAt),
                  })
                : m.settings_security_session_no_expiry({ created: formatInstant(session.createdAt) })}
            </span>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={controller.busy}
              onClick={() => void controller.revoke(session.id)}
            >
              {m.settings_security_revoke()}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SecuritySection() {
  const strictProvider = resolveStrictOidcProvider(useAuth().providers);
  const controller = useSecurityController(strictProvider);
  return (
    <SettingsSection
      title={m.settings_security_title()}
      help={m.settings_security_description()}
      testId="security-section"
      contentClassName="gap-5"
    >
      {strictProvider && <ProviderConnection provider={strictProvider} controller={controller} />}
      <PasswordForm controller={controller} />
      <Separator />
      <SessionList controller={controller} />
      <FieldError id={controller.fieldError.errorId}>{controller.fieldError.error}</FieldError>
      {controller.message && (
        <p role="status" className="text-sm text-ok">
          {controller.message}
        </p>
      )}
    </SettingsSection>
  );
}
