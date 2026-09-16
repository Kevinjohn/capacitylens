import { Fragment, type ReactNode } from "react";
import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { MAX_EMAIL_LENGTH } from "@capacitylens/shared/lib/strings";
import type { TeamInvitation } from "../../account/teamAccessClient";
import type { InvitationPersonOption } from "./useMemberInvites";
import { formatInviteExpiryDate } from "@/components/invites/inviteExpiry";
import { resolveRoleLabel, resolveRoleSummary } from "../../lib/accessCopy";
import { SelectField, TextField } from "../common/ui";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { FieldError, FieldSet } from "../ui/field";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";

/**
 * A write-once "here is a freshly-minted link, copy it now" block (shared by the invite link and the
 * password-reset link). Renders the `break-all` <code> + ghost copy Button once; the token behind the
 * link is never read back. Pass `intro` (a <p>) to prepend an explanatory line — the reset block uses
 * it to name WHO/when; the invite block omits it. Structure is intentionally two shapes (the intro
 * variant needs an outer vertical stack) so both call sites keep their exact prior markup.
 */
export function CopyableLinkBlock({
  link,
  testId,
  copiedNotice,
  copyLabel,
  copyLink,
  intro,
}: {
  link: string;
  testId: string;
  copiedNotice: string;
  copyLabel: string;
  copyLink: (link: string, copiedNotice: string) => void;
  intro?: ReactNode;
}) {
  const code = (
    <code data-testid={testId} className="min-w-0 flex-1 break-all text-xs text-ink">
      {link}
    </code>
  );
  const button = (
    <Button aria-label={copyLabel} size="sm" variant="outline" onClick={() => copyLink(link, copiedNotice)}>
      {m.settings_invite_copy()}
    </Button>
  );
  if (intro) {
    return (
      <div className="mb-4 flex flex-col gap-2 rounded bg-canvas p-2">
        {intro}
        <div className="flex flex-wrap items-center gap-2">
          {code}
          {button}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded bg-canvas p-2">
      {code}
      {button}
    </div>
  );
}

export function InviteMemberPanel(props: {
  authMode: string;
  busy: boolean;
  inviteRole: InvitationRole;
  setInviteRole(role: InvitationRole): void;
  invitationPreauthorizedEmail: string;
  setInvitationPreauthorizedEmail(value: string): void;
  error: string | null;
  errorField: string | null;
  errorId: string;
  clear(): void;
  mintedLink: { inviteId: string | null; link: string } | null;
  copyLink(link: string, copiedNotice: string): void;
  submitInvite(): Promise<void>;
  invites: readonly TeamInvitation[];
  renderedAt: number;
  revokeInvite(id: string): Promise<void>;
  roleOptions: { value: Role; label: string }[];
  invitationPeople: readonly InvitationPersonOption[];
  invitationResourceId: string;
  setInvitationResourceId(value: string): void;
}) {
  return (
    <Card data-testid="invites-section" aria-busy={props.busy}>
      <InviteHeader />
      <CardContent className="flex flex-col gap-4">
        <InviteForm {...props} />
        <OutstandingInvites {...props} />
      </CardContent>
    </Card>
  );
}

function InviteHeader() {
  return (
    <CardHeader>
      <CardTitle>
        <h2>{m.settings_invite_heading()}</h2>
      </CardTitle>
      <CardDescription>{m.settings_invite_intro({ app: APP_NAME })}</CardDescription>
    </CardHeader>
  );
}

type InviteFormProps = Pick<
  Parameters<typeof InviteMemberPanel>[0],
  | "authMode"
  | "busy"
  | "inviteRole"
  | "setInviteRole"
  | "invitationPreauthorizedEmail"
  | "setInvitationPreauthorizedEmail"
  | "error"
  | "errorField"
  | "errorId"
  | "clear"
  | "mintedLink"
  | "copyLink"
  | "submitInvite"
  | "roleOptions"
  | "invitationPeople"
  | "invitationResourceId"
  | "setInvitationResourceId"
>;

function InviteForm(props: InviteFormProps) {
  const {
    authMode,
    busy,
    inviteRole,
    setInviteRole,
    invitationPreauthorizedEmail,
    setInvitationPreauthorizedEmail,
    error,
    errorField,
    errorId,
    clear,
    mintedLink,
    copyLink,
    submitInvite,
    roleOptions,
    invitationPeople,
    invitationResourceId,
    setInvitationResourceId,
  } = props;
  return (
    <FieldSet className="gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40">
          <SelectField
            label={m.settings_invite_role_label()}
            ariaLabel={m.settings_invite_role_aria()}
            value={inviteRole}
            onChange={(value) => setInviteRole(value as InvitationRole)}
            disabled={busy}
            options={roleOptions}
            testId="invite-role"
          />
        </div>
        <InviteEmailField
          {...{
            authMode,
            busy,
            invitationPreauthorizedEmail,
            setInvitationPreauthorizedEmail,
            errorField,
            errorId,
            clear,
          }}
        />
        <div className="min-w-48 flex-1">
          <SelectField
            label={m.settings_invite_person_label()}
            ariaLabel={m.settings_invite_person_aria()}
            value={invitationResourceId}
            onChange={setInvitationResourceId}
            disabled={busy}
            options={[
              { value: "", label: m.settings_invite_person_none() },
              ...invitationPeople.map((person) => ({ value: person.id, label: person.label })),
            ]}
            testId="invite-person"
          />
        </div>
        <Button size="sm" data-testid="invite-submit" disabled={busy} onClick={() => void submitInvite()}>
          {m.settings_invite_submit()}
        </Button>
      </div>
      <p id={`${errorId}-email-help`} className="text-xs text-muted-foreground">
        {authMode === "sso" ? m.settings_invite_preauth_description_sso() : m.settings_invite_preauth_description()}
      </p>
      <p className="text-xs text-muted-foreground" data-testid="invite-role-summary" aria-live="polite">
        {resolveRoleSummary(inviteRole)}
      </p>
      <FieldError id={errorId}>{errorField === "invite" ? error : null}</FieldError>
      <MintedInviteLink mintedLink={mintedLink} copyLink={copyLink} />
    </FieldSet>
  );
}

function MintedInviteLink({ mintedLink, copyLink }: Pick<InviteFormProps, "mintedLink" | "copyLink">) {
  if (!mintedLink) return null;
  return (
    <div
      data-testid="invite-created-status"
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2 rounded border border-ok/40 bg-ok/5 p-3"
    >
      <p className="text-sm font-medium text-ok">{m.settings_members_invite_created()}</p>
      <CopyableLinkBlock
        link={mintedLink.link}
        testId="invite-link"
        copiedNotice={m.settings_members_invite_copied()}
        copyLabel={m.settings_invite_copy_aria()}
        copyLink={copyLink}
      />
      <p className="text-xs text-muted-foreground">{m.settings_members_invite_created_recovery()}</p>
    </div>
  );
}

type InviteEmailFieldProps = Pick<
  InviteFormProps,
  | "authMode"
  | "busy"
  | "invitationPreauthorizedEmail"
  | "setInvitationPreauthorizedEmail"
  | "errorField"
  | "errorId"
  | "clear"
>;

function InviteEmailField(props: InviteEmailFieldProps) {
  const { authMode, busy, invitationPreauthorizedEmail, setInvitationPreauthorizedEmail, errorField, errorId, clear } =
    props;
  return (
    <div className="min-w-48 flex-1">
      <TextField
        label={authMode === "sso" ? m.settings_invite_preauth_label_required() : m.settings_invite_preauth_label()}
        ariaLabel={m.settings_invite_preauth_aria()}
        type="email"
        value={invitationPreauthorizedEmail}
        maxLength={MAX_EMAIL_LENGTH}
        onChange={(next) => {
          setInvitationPreauthorizedEmail(next);
          if (errorField === "invite") clear();
        }}
        disabled={busy}
        invalid={errorField === "invite"}
        required={authMode === "sso"}
        externalDescriptionId={`${errorId}-email-help`}
        describedById={errorId}
        placeholder={m.settings_invite_preauth_placeholder()}
        testId="invite-preauth"
      />
    </div>
  );
}

type OutstandingInvitesProps = Pick<
  Parameters<typeof InviteMemberPanel>[0],
  "invites" | "renderedAt" | "busy" | "revokeInvite" | "invitationPeople"
>;

function resolveInvitationStatus(invitation: TeamInvitation, expired: boolean): string {
  if (invitation.usedAt) return m.settings_invite_suffix_used();
  if (expired) return m.settings_invite_suffix_expired();
  // Invite validity spans several days, so keep this compact row date-only while rendering the
  // date on the viewer's local calendar rather than slicing UTC.
  return m.settings_invite_suffix_expires({ date: formatInviteExpiryDate(invitation.expiresAt) });
}

function resolveInvitationPerson(invitation: TeamInvitation, people: readonly InvitationPersonOption[]): string | null {
  if (!invitation.proposedResourceId) return null;
  if (invitation.proposedResourceLabel) return invitation.proposedResourceLabel;
  return (
    people.find((person) => person.id === invitation.proposedResourceId)?.label ?? m.settings_invite_person_missing()
  );
}

function OutstandingInvites({ invites, renderedAt, busy, revokeInvite, invitationPeople }: OutstandingInvitesProps) {
  if (invites.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="mb-1 text-xs font-semibold text-ink">{m.settings_invites_outstanding_heading()}</h3>
      <ItemGroup className="rounded-md border bg-card">
        {invites.map((invitation, index) => {
          const expired = Date.parse(invitation.expiresAt) <= renderedAt;
          const actionable = invitation.usedAt === null && !expired;
          const proposedPerson = resolveInvitationPerson(invitation, invitationPeople);
          return (
            <Fragment key={invitation.id}>
              {index > 0 && <ItemSeparator />}
              <Item size="sm" role="listitem" className="rounded-none" data-testid="invite-row">
                <ItemContent className="flex-row flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink">
                  <span className="font-medium">{resolveRoleLabel(invitation.role)}</span>
                  <span className="text-muted-foreground">
                    {invitation.preauthEmail
                      ? m.settings_invite_suffix_email({ email: invitation.preauthEmail })
                      : m.settings_invite_suffix_link()}
                  </span>
                  <span className="text-muted-foreground">{resolveInvitationStatus(invitation, expired)}</span>
                  {proposedPerson && (
                    <span className="basis-full text-xs text-muted-foreground">
                      {m.settings_invite_person_pending({ person: proposedPerson })}{" "}
                      {m.settings_invite_person_not_reserved()}
                    </span>
                  )}
                </ItemContent>
                {actionable && (
                  <ItemActions>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="invite-revoke"
                      disabled={busy}
                      onClick={() => void revokeInvite(invitation.id)}
                    >
                      {m.settings_invite_revoke()}
                    </Button>
                  </ItemActions>
                )}
              </Item>
            </Fragment>
          );
        })}
      </ItemGroup>
    </div>
  );
}
