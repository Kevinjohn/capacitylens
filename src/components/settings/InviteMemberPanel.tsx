import { useState, type ReactNode } from "react";
import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { MAX_EMAIL_LENGTH } from "@capacitylens/shared/lib/strings";
import type { TeamInvitation } from "../../account/teamAccessClient";
import type { InvitationPersonOption } from "./useMemberInvites";
import { formatInviteExpiryDate } from "@/components/invites/inviteExpiry";
import { resolveRoleLabel, resolveRoleSummary } from "../../lib/accessCopy";
import { Modal, SelectField, TextField } from "../common/ui";
import { Button } from "../ui/button";
import { FieldError, FieldSet } from "../ui/field";
import { sortInvitationsForPresentation } from "./buildMemberDirectoryPresentation";

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
  const [open, setOpen] = useState(false);
  return (
    <section data-testid="invites-section" aria-busy={props.busy} className="flex flex-col gap-4">
      <InviteHeader onOpen={() => setOpen(true)} />
      {open && (
        <Modal
          title={m.settings_invite_heading()}
          description={m.settings_invite_intro({ app: APP_NAME })}
          onClose={() => setOpen(false)}
          onSubmit={() => void props.submitInvite()}
          footer={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                {m.form_cancel()}
              </Button>
              <Button type="submit" size="sm" data-testid="invite-submit" disabled={props.busy}>
                {m.settings_invite_submit()}
              </Button>
            </>
          }
        >
          <InviteForm {...props} />
        </Modal>
      )}
      <OutstandingInvites {...props} />
    </section>
  );
}

function InviteHeader({ onOpen }: { onOpen: () => void }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">{m.settings_invite_heading()}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{m.settings_invite_intro({ app: APP_NAME })}</p>
      </div>
      <Button type="button" data-testid="invite-open" onClick={onOpen}>
        {m.settings_invite_open()}
      </Button>
    </header>
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
    roleOptions,
    invitationPeople,
    invitationResourceId,
    setInvitationResourceId,
  } = props;
  return (
    <FieldSet className="gap-3">
      <SelectField
        label={m.settings_invite_role_label()}
        ariaLabel={m.settings_invite_role_aria()}
        value={inviteRole}
        onChange={(value) => setInviteRole(value as InvitationRole)}
        disabled={busy}
        options={roleOptions}
        layout="label-control"
        testId="invite-role"
      />
      <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] sm:gap-3">
        <p
          className="text-xs text-muted-foreground sm:col-start-2"
          data-testid="invite-role-summary"
          aria-live="polite"
        >
          {resolveRoleSummary(inviteRole)}
        </p>
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
        layout="label-control"
        testId="invite-person"
      />
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
    <TextField
      label={m.settings_invite_preauth_label()}
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
      layout="label-control"
      required={authMode === "sso"}
      describedById={errorId}
      placeholder={m.settings_invite_preauth_placeholder()}
      testId="invite-preauth"
    />
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
    <section data-testid="outstanding-invites" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">{m.settings_invites_outstanding_heading()}</h3>
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs font-medium text-muted-foreground">
              <th scope="col" className="py-2 px-4 font-medium">
                {m.settings_member_col_name()}
              </th>
              <th scope="col" className="py-2 px-4 font-medium">
                {m.settings_invite_role_label()}
              </th>
              <th scope="col" className="py-2 px-4 font-medium">
                {m.settings_member_col_email()}
              </th>
              <th scope="col" className="py-2 px-4 font-medium">
                {m.settings_member_col_scheduled_person()}
              </th>
              <th scope="col" className="py-2 px-4 text-right font-medium">
                {m.settings_member_col_actions()}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortInvitationsForPresentation(invites).map((invitation) => {
              const expired = Date.parse(invitation.expiresAt) <= renderedAt;
              const actionable = invitation.usedAt === null && !expired;
              const proposedPerson = resolveInvitationPerson(invitation, invitationPeople);
              return (
                <tr key={invitation.id} className="border-b last:border-b-0" data-testid="invite-row">
                  <td className="py-2 px-4">—</td>
                  <td className="py-2 px-4">{resolveRoleLabel(invitation.role)}</td>
                  <td className="max-w-52 py-2 px-4 text-xs text-muted-foreground">
                    <span className="block truncate" title={invitation.preauthEmail ?? undefined}>
                      {invitation.preauthEmail ?? m.settings_invite_table_link()}
                    </span>
                    <span className="block">
                      {resolveInvitationStatus(invitation, expired).replace(/^\s*·\s*/, "")}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-xs text-muted-foreground">
                    {proposedPerson ? (
                      <>
                        {proposedPerson}{" "}
                        {actionable && <span className="text-warn">{m.settings_invite_table_pending()}</span>}
                      </>
                    ) : (
                      m.settings_member_resource_not_linked()
                    )}
                  </td>
                  <td className="py-2 px-4 text-right">
                    {actionable && (
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="invite-revoke"
                        disabled={busy}
                        onClick={() => void revokeInvite(invitation.id)}
                      >
                        {m.settings_invite_revoke()}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
