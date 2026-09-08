import type { FormEvent, RefCallback } from "react";
import { Link } from "react-router-dom";
import { APP_NAME } from "@capacitylens/shared/brand";
import type { Role } from "@capacitylens/shared/domain/access";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import { MAX_EMAIL_LENGTH, MAX_NAME_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_INPUT_CODE_UNITS } from "@capacitylens/shared/domain/password";
import type { AccountMode, AuthProviderInfo, AuthUser } from "../../auth/authContext";
import { resolveRoleLabel, resolveRoleSummary } from "../../lib/accessCopy";
import { m } from "@/i18n";
import { TextField } from "../common/ui";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FieldError } from "../ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "../ui/item";

export type InviteAcceptState =
  | { kind: "previewing" }
  | { kind: "ready" }
  | { kind: "accepting" }
  | { kind: "joined"; accountId: string; role: Role; activating: boolean }
  | {
      kind: "error";
      message: string;
      retryAccept?: boolean;
      retryPreview?: boolean;
      switchIdentity?: boolean;
    }
  | { kind: "auth"; message?: string; errorField?: string | null }
  | { kind: "local" };

export interface InvitePreview {
  accountName: string;
  role: InvitationRole;
  expiresAt: string;
}

interface InviteAcceptViewProps {
  state: InviteAcceptState;
  preview: InvitePreview | null;
  user: AuthUser | null;
  authMode: AccountMode;
  providers: readonly AuthProviderInfo[];
  busy: boolean;
  errorId: string;
  name: string;
  email: string;
  password: string;
  flowStatusRef: RefCallback<HTMLParagraphElement>;
  continueRef: RefCallback<HTMLAnchorElement>;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onAccept: () => void;
  onSignOut: () => void;
  onSignIn: (event: FormEvent) => void;
  onProviderSignIn: (provider: AuthProviderInfo) => void;
  onCreateAccount: () => void;
  onRetryPreview: () => void;
}

/** Pure state-specific presentation for the invite route; async orchestration stays in useInviteAcceptController. */
export function InviteAcceptView(props: InviteAcceptViewProps) {
  const { state, preview, flowStatusRef } = props;
  const flowStatus = resolveFlowStatus(state, preview);
  const showsFlowStatus = ["previewing", "ready", "accepting", "joined"].includes(state.kind);

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <Card>
          <CardHeader className="text-center">
            <div className="text-2xl font-bold text-brand">{APP_NAME}</div>
            <CardTitle>
              <h1>{m.invite_title()}</h1>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {preview && <InvitePreviewDetails preview={preview} />}
            <p
              ref={flowStatusRef}
              role="status"
              tabIndex={-1}
              className={showsFlowStatus ? "text-sm text-muted-foreground" : "sr-only"}
            >
              {flowStatus}
            </p>
            <InviteStateContent {...props} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function resolveFlowStatus(state: InviteAcceptState, preview: InvitePreview | null) {
  if (state.kind === "previewing") return m.invite_checking();
  if (state.kind === "ready") return m.invite_review_prompt();
  if (state.kind === "accepting") return m.invite_joining();
  if (state.kind !== "joined") return "";
  if (preview) {
    return m.invite_joined_company({ company: preview.accountName, role: resolveRoleLabel(state.role) });
  }
  return `${m.invite_joined_base()}${m.invite_joined_role({ role: state.role })}.`;
}

function InvitePreviewDetails({ preview }: { preview: InvitePreview }) {
  return (
    <Item variant="muted" data-testid="invite-preview">
      <ItemContent>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.invite_company_label()}</p>
        <ItemTitle>
          <h2>{preview.accountName}</h2>
        </ItemTitle>
        <ItemDescription>{resolveRoleSummary(preview.role)}</ItemDescription>
        <ItemDescription>{m.invite_existing_role_note()}</ItemDescription>
        <ItemDescription>{m.invite_expires({ when: new Date(preview.expiresAt).toLocaleString() })}</ItemDescription>
      </ItemContent>
      <ItemActions className="self-start text-right">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{m.invite_proposed_role_label()}</p>
          <Badge>{resolveRoleLabel(preview.role)}</Badge>
        </div>
      </ItemActions>
    </Item>
  );
}

function InviteStateContent(props: InviteAcceptViewProps) {
  switch (props.state.kind) {
    case "ready":
      return <ReadyContent {...props} />;
    case "joined":
      return props.state.activating ? null : <JoinedContent continueRef={props.continueRef} />;
    case "auth":
      return props.authMode === "sso" ? <SsoContent {...props} /> : <PasswordContent {...props} />;
    case "error":
      return <ErrorContent {...props} />;
    case "local":
      return <LocalContent />;
    case "previewing":
    case "accepting":
      return null;
  }
}

function ReadyContent({ user, busy, onSignOut, onAccept }: InviteAcceptViewProps) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {m.invite_signed_in_as({ identity: user?.email ?? user?.name ?? m.invite_current_account() })}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" type="button" variant="outline" disabled={busy} onClick={onSignOut}>
          {m.invite_use_different_account()}
        </Button>
        <Button asChild size="sm">
          <Link to="/">{m.invite_go_to_app()}</Link>
        </Button>
        <Button size="sm" type="button" disabled={busy} onClick={onAccept}>
          {m.invite_accept_action()}
        </Button>
      </div>
    </>
  );
}

function JoinedContent({ continueRef }: Pick<InviteAcceptViewProps, "continueRef">) {
  return (
    <div className="flex justify-end">
      <Button asChild size="sm">
        <Link ref={continueRef} to="/">
          {m.invite_continue()}
        </Link>
      </Button>
    </div>
  );
}

function SsoContent({ state, providers, busy, errorId, onProviderSignIn }: InviteAcceptViewProps) {
  if (state.kind !== "auth") return null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{m.invite_sso_prompt()}</p>
      <FieldError id={errorId}>{state.message}</FieldError>
      {providers.length === 0 ? (
        <FieldError>{m.invite_sso_unavailable()}</FieldError>
      ) : (
        <ProviderButtons providers={providers} busy={busy} onSelect={onProviderSignIn} />
      )}
    </div>
  );
}

function PasswordContent(props: InviteAcceptViewProps) {
  const { state, providers, busy, errorId, onProviderSignIn, onSignIn, onCreateAccount } = props;
  if (state.kind !== "auth") return null;
  return (
    <div className="flex flex-col gap-4">
      {providers.length > 0 && (
        <div className="flex flex-col gap-2">
          <ProviderButtons providers={providers} busy={busy} onSelect={onProviderSignIn} />
          <p className="text-center text-xs text-muted-foreground">{m.invite_use_email_password()}</p>
        </div>
      )}
      <form onSubmit={onSignIn} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-muted-foreground">{m.invite_onboard_intro()}</p>
        <SignInFields {...props} errorField={state.errorField} />
        <FieldError id={errorId}>{state.message}</FieldError>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" type="submit" variant="outline" disabled={busy}>
            {m.invite_sign_in_accept()}
          </Button>
          <Button size="sm" type="button" disabled={busy} onClick={onCreateAccount}>
            {m.invite_create_account()}
          </Button>
        </div>
      </form>
    </div>
  );
}

function SignInFields({
  name,
  email,
  password,
  errorId,
  errorField,
  onNameChange,
  onEmailChange,
  onPasswordChange,
}: InviteAcceptViewProps & { errorField: string | null | undefined }) {
  return (
    <>
      <TextField
        label={m.invite_name()}
        autoComplete="name"
        value={name}
        maxLength={MAX_NAME_INPUT_CODE_UNITS}
        onChange={onNameChange}
        invalid={errorField === "name"}
        describedById={errorId}
      />
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
        autoComplete="current-password"
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

function ErrorContent(props: InviteAcceptViewProps) {
  const { state, preview, user, busy, onAccept, onSignOut, onRetryPreview } = props;
  if (state.kind !== "error") return null;
  return (
    <>
      <FieldError>{state.message}</FieldError>
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild size="sm">
          <Link to="/">{m.invite_go_to_app()}</Link>
        </Button>
        {state.retryAccept && preview && user && (
          <Button size="sm" type="button" disabled={busy} onClick={onAccept}>
            {m.invite_retry_accept()}
          </Button>
        )}
        {state.switchIdentity && (
          <Button size="sm" type="button" variant="outline" disabled={busy} onClick={onSignOut}>
            {m.invite_use_different_account()}
          </Button>
        )}
        {state.retryPreview && (
          <Button size="sm" type="button" onClick={onRetryPreview}>
            {m.common_try_again()}
          </Button>
        )}
      </div>
    </>
  );
}

function LocalContent() {
  return (
    <>
      <p className="text-sm text-muted-foreground">{m.invite_local_mode({ app: APP_NAME })}</p>
      <div className="flex justify-end">
        <Button asChild size="sm">
          <Link to="/">{m.invite_go_to_app()}</Link>
        </Button>
      </div>
    </>
  );
}

function ProviderButtons({
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
