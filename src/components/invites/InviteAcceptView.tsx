import type { FormEvent, RefCallback } from "react";
import { Link } from "react-router-dom";
import { APP_NAME } from "@capacitylens/shared/brand";
import type { Role } from "@capacitylens/shared/domain/access";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import { MAX_EMAIL_LENGTH, MAX_NAME_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_INPUT_CODE_UNITS } from "@capacitylens/shared/domain/password";
import type { AuthMode, AuthProviderInfo, AuthUser } from "../../auth/authContext";
import { roleLabel, roleSummary } from "../../lib/accessCopy";
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
  authMode: AuthMode;
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
export function InviteAcceptView({
  state,
  preview,
  user,
  authMode,
  providers,
  busy,
  errorId,
  name,
  email,
  password,
  flowStatusRef,
  continueRef,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onAccept,
  onSignOut,
  onSignIn,
  onProviderSignIn,
  onCreateAccount,
  onRetryPreview,
}: InviteAcceptViewProps) {
  const joinedStatus =
    state.kind === "joined"
      ? preview
        ? m.invite_joined_company({ company: preview.accountName, role: roleLabel(state.role) })
        : `${m.invite_joined_base()}${state.role ? m.invite_joined_role({ role: state.role }) : ""}.`
      : null;
  const flowStatus =
    state.kind === "previewing"
      ? m.invite_checking()
      : state.kind === "ready"
        ? m.invite_review_prompt()
        : state.kind === "accepting"
          ? m.invite_joining()
          : (joinedStatus ?? "");
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
            {preview && (
              <Item variant="muted" data-testid="invite-preview">
                <ItemContent>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {m.invite_company_label()}
                  </p>
                  <ItemTitle>
                    <h2>{preview.accountName}</h2>
                  </ItemTitle>
                  <ItemDescription>{roleSummary(preview.role)}</ItemDescription>
                  <ItemDescription>{m.invite_existing_role_note()}</ItemDescription>
                  <ItemDescription>
                    {m.invite_expires({ when: new Date(preview.expiresAt).toLocaleString() })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="self-start text-right">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{m.invite_proposed_role_label()}</p>
                    <Badge>{roleLabel(preview.role)}</Badge>
                  </div>
                </ItemActions>
              </Item>
            )}
            <p
              ref={flowStatusRef}
              role="status"
              tabIndex={-1}
              className={showsFlowStatus ? "text-sm text-muted-foreground" : "sr-only"}
            >
              {flowStatus}
            </p>
            {state.kind === "ready" && (
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
            )}
            {state.kind === "joined" && !state.activating && (
              <div className="flex justify-end">
                <Button asChild size="sm">
                  <Link ref={continueRef} to="/">
                    {m.invite_continue()}
                  </Link>
                </Button>
              </div>
            )}
            {state.kind === "auth" &&
              (authMode === "sso" ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">{m.invite_sso_prompt()}</p>
                  <FieldError id={errorId}>{state.message}</FieldError>
                  {providers.length === 0 ? (
                    <FieldError>{m.invite_sso_unavailable()}</FieldError>
                  ) : (
                    <ProviderButtons providers={providers} busy={busy} onSelect={onProviderSignIn} />
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {providers.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <ProviderButtons providers={providers} busy={busy} onSelect={onProviderSignIn} />
                      <p className="text-center text-xs text-muted-foreground">{m.invite_use_email_password()}</p>
                    </div>
                  )}
                  <form onSubmit={onSignIn} className="flex flex-col gap-3" noValidate>
                    <p className="text-sm text-muted-foreground">{m.invite_onboard_intro()}</p>
                    <TextField
                      label={m.invite_name()}
                      autoComplete="name"
                      value={name}
                      maxLength={MAX_NAME_INPUT_CODE_UNITS}
                      onChange={onNameChange}
                      invalid={state.errorField === "name"}
                      describedById={errorId}
                    />
                    <TextField
                      label={m.login_email()}
                      type="email"
                      autoComplete="email"
                      value={email}
                      maxLength={MAX_EMAIL_LENGTH}
                      onChange={onEmailChange}
                      invalid={state.errorField === "email"}
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
                      invalid={state.errorField === "password"}
                      describedById={errorId}
                    />
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
              ))}
            {state.kind === "error" && (
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
            )}
            {state.kind === "local" && (
              <>
                <p className="text-sm text-muted-foreground">{m.invite_local_mode({ app: APP_NAME })}</p>
                <div className="flex justify-end">
                  <Button asChild size="sm">
                    <Link to="/">{m.invite_go_to_app()}</Link>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
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
