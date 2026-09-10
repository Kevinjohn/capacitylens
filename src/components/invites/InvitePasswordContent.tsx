import { useId, useState, type FormEvent } from "react";
import type { AuthProviderInfo } from "../../auth/authContext";
import { MAX_EMAIL_LENGTH, MAX_NAME_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_INPUT_CODE_UNITS } from "@capacitylens/shared/domain/password";
import { m } from "@/i18n";
import { TextField } from "../common/ui";
import { Button } from "../ui/button";
import { FieldError } from "../ui/field";

interface InvitePasswordContentProps {
  providers: readonly AuthProviderInfo[];
  busy: boolean;
  errorId: string;
  errorMessage: string | undefined;
  errorField: string | null | undefined;
  name: string;
  email: string;
  password: string;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSignIn: (event: FormEvent) => void;
  onProviderSignIn: (provider: AuthProviderInfo) => void;
  onCreateAccount: () => void;
  onPathChange: () => void;
}

/** Presents separate existing-account and atomic account-creation paths for a password invite. */
export function InvitePasswordContent(props: InvitePasswordContentProps) {
  const [path, setPath] = useState<"sign-in" | "create-account">("sign-in");
  const signInTabId = useId();
  const createAccountTabId = useId();
  const signInPanelId = useId();
  const createAccountPanelId = useId();
  return (
    <div className="flex flex-col gap-4">
      {props.providers.length > 0 && (
        <div className="flex flex-col gap-2">
          <InviteProviderButtons providers={props.providers} busy={props.busy} onSelect={props.onProviderSignIn} />
          <p className="text-center text-xs text-muted-foreground">{m.invite_use_email_password()}</p>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{m.invite_onboard_intro()}</p>
      <div
        role="tablist"
        aria-label={m.invite_onboard_intro()}
        className="grid w-full grid-cols-2 rounded-md bg-muted p-1"
      >
        <AuthPathTab
          active={path === "sign-in"}
          disabled={props.busy}
          controls={signInPanelId}
          id={signInTabId}
          onSelect={() => {
            setPath("sign-in");
            props.onPathChange();
          }}
        >
          {m.invite_sign_in_accept()}
        </AuthPathTab>
        <AuthPathTab
          active={path === "create-account"}
          disabled={props.busy}
          controls={createAccountPanelId}
          id={createAccountTabId}
          onSelect={() => {
            setPath("create-account");
            props.onPathChange();
          }}
        >
          {m.invite_create_account_tab()}
        </AuthPathTab>
      </div>
      <div id={signInPanelId} role="tabpanel" aria-labelledby={signInTabId} hidden={path !== "sign-in"}>
        {path === "sign-in" ? <SignInForm {...props} /> : null}
      </div>
      <div
        id={createAccountPanelId}
        role="tabpanel"
        aria-labelledby={createAccountTabId}
        hidden={path !== "create-account"}
      >
        {path === "create-account" ? <SignupForm {...props} /> : null}
      </div>
    </div>
  );
}

function AuthPathTab({
  active,
  children,
  controls,
  disabled,
  id,
  onSelect,
}: {
  active: boolean;
  children: string;
  controls: string;
  disabled: boolean;
  id: string;
  onSelect: () => void;
}) {
  return (
    <button
      id={id}
      role="tab"
      type="button"
      aria-controls={controls}
      aria-selected={active}
      disabled={disabled}
      tabIndex={active ? 0 : -1}
      className="rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-xs"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = Array.from(
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? [],
        );
        const currentIndex = tabs.indexOf(event.currentTarget);
        let targetIndex = (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        if (event.key === "Home") targetIndex = 0;
        if (event.key === "End") targetIndex = tabs.length - 1;
        event.preventDefault();
        tabs[targetIndex]?.focus();
        tabs[targetIndex]?.click();
      }}
    >
      {children}
    </button>
  );
}

function SignInForm(props: InvitePasswordContentProps) {
  return (
    <form onSubmit={props.onSignIn} className="flex flex-col gap-3" noValidate>
      <EmailPasswordFields {...props} passwordAutoComplete="current-password" />
      <FieldError id={props.errorId}>{props.errorMessage}</FieldError>
      <Button className="w-full" size="sm" type="submit" disabled={props.busy}>
        {m.invite_sign_in_accept()}
      </Button>
    </form>
  );
}

function SignupForm(props: InvitePasswordContentProps) {
  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        props.onCreateAccount();
      }}
    >
      <TextField
        label={m.invite_name()}
        autoComplete="name"
        value={props.name}
        maxLength={MAX_NAME_INPUT_CODE_UNITS}
        onChange={props.onNameChange}
        invalid={props.errorField === "name"}
        describedById={props.errorId}
      />
      <EmailPasswordFields {...props} passwordAutoComplete="new-password" />
      <FieldError id={props.errorId}>{props.errorMessage}</FieldError>
      <Button className="w-full" size="sm" type="submit" disabled={props.busy}>
        {m.invite_create_account()}
      </Button>
    </form>
  );
}

function EmailPasswordFields({
  email,
  password,
  errorId,
  errorField,
  onEmailChange,
  onPasswordChange,
  passwordAutoComplete,
}: InvitePasswordContentProps & { passwordAutoComplete: "current-password" | "new-password" }) {
  return (
    <>
      <TextField
        label={m.login_email()}
        type="email"
        autoComplete="email"
        value={email}
        maxLength={MAX_EMAIL_LENGTH}
        onChange={onEmailChange}
        invalid={errorField === "email"}
        describedById={errorId}
      />
      <TextField
        label={m.login_password()}
        type="password"
        autoComplete={passwordAutoComplete}
        value={password}
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
        onChange={onPasswordChange}
        invalid={errorField === "password"}
        describedById={errorId}
      />
    </>
  );
}

/** Renders configured external sign-in choices shared by password and SSO invite journeys. */
export function InviteProviderButtons({
  providers,
  busy,
  onSelect,
}: {
  providers: readonly AuthProviderInfo[];
  busy: boolean;
  onSelect: (provider: AuthProviderInfo) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {providers.map((provider) => (
        <Button
          size="sm"
          key={provider.id}
          type="button"
          className="w-full"
          disabled={busy}
          onClick={() => onSelect(provider)}
        >
          {m.invite_continue_provider({ provider: provider.label })}
        </Button>
      ))}
    </div>
  );
}
