import type { FormEvent, RefCallback } from "react";
import { Link } from "react-router-dom";
import { APP_NAME } from "@capacitylens/shared/brand";
import type { Role } from "@capacitylens/shared/domain/access";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { AccountMode, AuthProviderInfo, AuthUser } from "../../auth/authContext";
import { resolveRoleLabel, resolveRoleSummary } from "../../lib/accessCopy";
import { m } from "@/i18n";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FieldError } from "../ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "../ui/item";
import { InvitePasswordContent, InviteProviderButtons } from "./InvitePasswordContent";
import { formatInviteExpiry } from "./inviteExpiry";

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
  emailBound: boolean | null;
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
  onClearAuthError: () => void;
  onRetryPreview: () => void;
}

/** Pure state-specific presentation for the invite route; async orchestration stays in useInviteAcceptController. */
export function InviteAcceptView(props: InviteAcceptViewProps) {
  const { state, preview, flowStatusRef } = props;
  const flowStatus = resolveFlowStatus(state, preview);
  const showsFlowStatus = ["previewing", "ready", "accepting", "joined"].includes(state.kind);

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-lg">
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
    <Item className="flex-col items-stretch" variant="muted" data-testid="invite-preview">
      <ItemActions className="w-full justify-between" data-testid="invite-role">
        <p className="text-xs font-medium text-muted-foreground">{m.invite_proposed_role_label()}</p>
        <Badge>{resolveRoleLabel(preview.role)}</Badge>
      </ItemActions>
      <ItemContent>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.invite_company_label()}</p>
        <ItemTitle>
          <h2>{preview.accountName}</h2>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">{resolveRoleSummary(preview.role)}</ItemDescription>
        <ItemDescription className="line-clamp-none">{m.invite_existing_role_note()}</ItemDescription>
        <ItemDescription className="line-clamp-none">{resolveEmailBoundaryCopy(preview.emailBound)}</ItemDescription>
        <ItemDescription className="line-clamp-none">
          {m.invite_expires({ when: formatInviteExpiry(preview.expiresAt) })}
        </ItemDescription>
      </ItemContent>
    </Item>
  );
}

function resolveEmailBoundaryCopy(emailBound: boolean | null) {
  if (emailBound === true) return m.invite_email_bound();
  if (emailBound === false) return m.invite_email_unbound();
  return m.invite_email_bound_unknown();
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
        <InviteProviderButtons providers={providers} busy={busy} onSelect={onProviderSignIn} />
      )}
    </div>
  );
}

function PasswordContent(props: InviteAcceptViewProps) {
  const { state } = props;
  if (state.kind !== "auth") return null;
  return (
    <InvitePasswordContent
      providers={props.providers}
      busy={props.busy}
      errorId={props.errorId}
      errorMessage={state.message}
      errorField={state.errorField}
      name={props.name}
      email={props.email}
      password={props.password}
      onNameChange={props.onNameChange}
      onEmailChange={props.onEmailChange}
      onPasswordChange={props.onPasswordChange}
      onSignIn={props.onSignIn}
      onProviderSignIn={props.onProviderSignIn}
      onCreateAccount={props.onCreateAccount}
      onPathChange={props.onClearAuthError}
    />
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
