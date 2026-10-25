import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import type { TeamInvitation } from "@/account/teamAccessClient";
import { formatInviteExpiryDate } from "@/components/invites/inviteExpiry";
import { resolveRoleLabel, resolveRoleSummary } from "@/lib/accessCopy";
import { Modal, SelectField, TextField } from "@/components/common/ui";
import { Button } from "@/components/ui/button";
import { FieldError, FieldSet } from "@/components/ui/field";
import { sortInvitationsForPresentation } from "./buildMemberDirectoryPresentation";

type InviteMemberPanelProps = {
  busy: boolean;
  inviteRole: InvitationRole;
  setInviteRole(role: InvitationRole): void;
  invitationPreauthorizedEmail: string;
  setInvitationPreauthorizedEmail(value: string): void;
  error: string | null;
  errorField: string | null;
  errorId: string;
  clear(): void;
  inviteDialogOpen: boolean;
  openInviteDialog(): void;
  closeInviteDialog(): void;
  submitInvite(): Promise<void>;
  invites: readonly TeamInvitation[];
  renderedAt: number;
  revokeInvite(id: string): Promise<void>;
  resendInvite(invitation: TeamInvitation): Promise<void>;
  roleOptions: { value: Role; label: string }[];
};

/** Emails an account invitation with a permitted role, and lists the pending ones. */
export function InviteMemberPanel(props: InviteMemberPanelProps) {
  return (
    <section data-testid="invites-section" aria-busy={props.busy} className="flex flex-col gap-4">
      <InviteHeader onOpen={props.openInviteDialog} />
      {props.inviteDialogOpen && (
        <Modal
          title={m.settings_invite_heading()}
          description={m.settings_invite_intro({ app: APP_NAME })}
          onClose={props.closeInviteDialog}
          onSubmit={() => void props.submitInvite()}
          footer={
            <>
              <Button type="button" variant="outline" size="sm" onClick={props.closeInviteDialog}>
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

function InviteForm(props: InviteMemberPanelProps) {
  const { busy, inviteRole, setInviteRole, error, errorField, errorId, clear } = props;
  return (
    <FieldSet className="gap-3">
      <SelectField
        label={m.settings_invite_role_label()}
        ariaLabel={m.settings_invite_role_aria()}
        value={inviteRole}
        onChange={(value) => setInviteRole(value as InvitationRole)}
        disabled={busy}
        options={props.roleOptions}
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
      <TextField
        label={m.settings_invite_preauth_label()}
        ariaLabel={m.settings_invite_preauth_aria()}
        type="email"
        value={props.invitationPreauthorizedEmail}
        onChange={(next) => {
          props.setInvitationPreauthorizedEmail(next);
          if (errorField === "invite") clear();
        }}
        disabled={busy}
        invalid={errorField === "invite"}
        layout="label-control"
        required
        describedById={errorId}
        placeholder={m.settings_invite_preauth_placeholder()}
        testId="invite-preauth"
      />
      <FieldError id={errorId}>{errorField === "invite" ? error : null}</FieldError>
    </FieldSet>
  );
}

function resolveInvitationStatus(invitation: TeamInvitation, expired: boolean): string {
  if (expired) return m.settings_invite_suffix_expired();
  // Invite validity spans several days, so keep this compact row date-only while rendering the
  // date on the viewer's local calendar rather than slicing UTC.
  return m.settings_invite_suffix_expires({ date: formatInviteExpiryDate(invitation.expiresAt) });
}

function OutstandingInvites({ invites, renderedAt, busy, revokeInvite, resendInvite }: InviteMemberPanelProps) {
  if (invites.length === 0) return null;
  return (
    <section data-testid="outstanding-invites" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">{m.settings_invites_outstanding_heading()}</h3>
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs font-medium text-muted-foreground">
              <th scope="col" className="py-2 px-4 font-medium">
                {m.settings_member_col_email()}
              </th>
              <th scope="col" className="py-2 px-4 font-medium">
                {m.settings_invite_role_label()}
              </th>
              <th scope="col" className="py-2 px-4 text-right font-medium">
                {m.settings_member_col_actions()}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortInvitationsForPresentation(invites).map((invitation) => {
              const expired = Date.parse(invitation.expiresAt) <= renderedAt;
              return (
                <tr key={invitation.id} className="border-b last:border-b-0" data-testid="invite-row">
                  <td className="max-w-52 py-2 px-4 text-xs text-muted-foreground">
                    <span className="block truncate" title={invitation.preauthEmail}>
                      {invitation.preauthEmail}
                    </span>
                    <span className="block">
                      {resolveInvitationStatus(invitation, expired).replace(/^\s*·\s*/, "")}
                    </span>
                  </td>
                  <td className="py-2 px-4">{resolveRoleLabel(invitation.role)}</td>
                  <td className="py-2 px-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="invite-resend"
                        aria-label={m.settings_invite_resend_aria({ email: invitation.preauthEmail })}
                        disabled={busy}
                        onClick={() => void resendInvite(invitation)}
                      >
                        {m.settings_invite_resend()}
                      </Button>
                      {!expired && (
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
                    </div>
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
