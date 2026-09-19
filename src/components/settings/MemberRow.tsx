import type { Dispatch, ReactNode, SetStateAction } from "react";
import { m } from "@/i18n";
import {
  can,
  canChangeMemberStatus,
  canEditAnyMemberRole,
  canRemoveMember,
  type Role,
} from "@capacitylens/shared/domain/access";
import type { TeamMember } from "../../account/teamAccessClient";
import { resolveRoleLabel } from "../../lib/accessCopy";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Eye, Pencil } from "lucide-react";
import type { MemberRoleEdit } from "./MemberConfirmations";
import { resolveMemberLabel, type MemberConfirmationAction } from "./memberConfirmationCopy";
import { MemberResourceDialog, MemberResourceLink } from "./MemberResourceLink";
import { MemberActionsDialog } from "./MemberActionsDialog";

/**
 * Which of a row's controls the viewer may see. Pure and shared by both member tables, so the
 * collapsed inactive group can never end up offering a different set of actions from the main one.
 * The CLIENT gate is courtesy only — the server refuses each of these regardless.
 */
function buildMemberAffordances(
  myRole: Role | undefined,
  member: TeamMember,
): {
  mayMasquerade: boolean;
  mayTouch: boolean;
  mayRemove: boolean;
  mayChangeStatus: boolean;
  mayReset: boolean;
  hasMenu: boolean;
} {
  // The role editor is ACTIVE-only, matching the server: changeMemberRole resolves its target
  // through getActiveMemberRole, so offering the pencil on a non-active row could only ever
  // produce a 404. Restore the member first, then change the role — a role change must not be a
  // back door that quietly reinstates access.
  const mayTouch = member.status === "active" && !!myRole && canEditAnyMemberRole(myRole, member.role);
  // Remove, by contrast, is status-agnostic on both sides: deleting a non-active membership is a
  // normal administrative act and must not require reinstating it first.
  const mayRemove = !!myRole && canRemoveMember(myRole, member.role);
  const mayChangeStatus = !!myRole && canChangeMemberStatus(myRole, member.role, member.isSelf);
  // Reset links exist only in PASSWORD mode ('sso' delegates credentials to the IdP;
  // the server 400s there regardless) and never for a target an admin can't touch
  // (e.g. an owner, or a member who owns another account — a reset link is an
  // account-takeover capability). We trust the SERVER-computed `mayResetPassword`:
  // it already folds in the cross-account + self-exemption checks the per-account
  // pure guard cannot see AND returns `false` in SSO mode.
  const mayReset = member.mayResetPassword;
  return {
    mayMasquerade: member.status === "active" && !member.isSelf && !!myRole && can(myRole, "masquerade"),
    mayTouch,
    mayRemove,
    mayChangeStatus,
    mayReset,
    hasMenu: mayReset || member.mayRevokeSessions || mayChangeStatus || mayRemove,
  };
}

/** A full-width action in the member-actions dialog. Keeping these as ordinary buttons avoids a
 * second menu/focus model inside the dialog; destructive actions still open their existing
 * confirmation dialogs. */
function MemberMenuItem({
  label,
  ariaLabel,
  testId,
  danger = false,
  onSelect,
}: {
  label: string;
  ariaLabel: string;
  testId: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant={danger ? "danger-soft" : "outline"}
      size="default"
      aria-label={ariaLabel}
      data-testid={testId}
      className="w-full justify-start"
      onClick={onSelect}
    >
      {label}
    </Button>
  );
}

interface MemberRowActions {
  busy: boolean;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
  setRoleEdit: Dispatch<SetStateAction<MemberRoleEdit | null>>;
}

function MemberIdentity({ member }: { member: TeamMember }) {
  const trimmedName = member.name?.trim();
  let name = member.userId;
  if (trimmedName) name = trimmedName;

  let roleLabel = resolveRoleLabel(member.role);
  if (member.role === "owner") roleLabel = m.settings_member_sole_owner_protected();

  let statusLabel: string | null = null;
  if (member.status === "disabled") statusLabel = m.settings_member_status_disabled();
  if (member.status === "archived") statusLabel = m.settings_member_status_archived();

  return (
    <td className="py-2 px-4">
      <div className="flex flex-col items-start gap-1">
        <span className="text-ink">
          {name}
          {member.isSelf && <span className="ml-1 text-xs text-muted-foreground">{m.settings_member_you()}</span>}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" data-testid="member-role">
            {roleLabel}
          </span>
          {statusLabel && (
            <Badge variant="outline" data-testid="member-status">
              {statusLabel}
            </Badge>
          )}
        </div>
      </div>
    </td>
  );
}

function MemberPrimaryActions({
  member,
  memberLabel,
  mayMasquerade,
  mayTouch,
  busy,
  chooseMemberAction,
  setRoleEdit,
  resourceLink,
  settingsMenu,
}: MemberRowActions & {
  member: TeamMember;
  memberLabel: string;
  mayMasquerade: boolean;
  mayTouch: boolean;
  resourceLink: ReactNode;
  settingsMenu: ReactNode;
}) {
  return (
    <td className="w-auto py-2 px-4 text-right whitespace-nowrap">
      <div className="flex justify-end gap-1">
        {mayMasquerade && (
          <Button
            size="icon-sm"
            variant="outline"
            title={m.settings_masquerade_aria({ member: memberLabel })}
            aria-label={m.settings_masquerade_aria({ member: memberLabel })}
            data-testid="member-masquerade"
            disabled={busy}
            onClick={() => chooseMemberAction("masquerade", member)}
          >
            <Eye />
          </Button>
        )}
        {mayTouch && (
          <Button
            size="icon-sm"
            variant="outline"
            title={m.settings_member_edit_aria({ member: memberLabel })}
            aria-label={m.settings_member_edit_aria({ member: memberLabel })}
            data-testid="member-edit"
            disabled={busy}
            onClick={() => setRoleEdit({ member: member, nextRole: member.role })}
          >
            <Pencil />
          </Button>
        )}
        {resourceLink}
        {settingsMenu}
      </div>
    </td>
  );
}

function MemberStatusMenuItems({
  member,
  memberLabel,
  chooseMemberAction,
}: {
  member: TeamMember;
  memberLabel: string;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
}) {
  if (member.status !== "active") {
    return (
      <MemberMenuItem
        testId="member-restore"
        label={m.settings_member_restore()}
        ariaLabel={m.settings_member_restore_aria({ member: memberLabel })}
        onSelect={() => chooseMemberAction("restore", member)}
      />
    );
  }
  return (
    <>
      <MemberMenuItem
        testId="member-disable"
        label={m.settings_member_disable()}
        ariaLabel={m.settings_member_disable_aria({ member: memberLabel })}
        onSelect={() => chooseMemberAction("disable", member)}
      />
      <MemberMenuItem
        testId="member-archive"
        label={m.settings_member_archive()}
        ariaLabel={m.settings_member_archive_aria({ member: memberLabel })}
        onSelect={() => chooseMemberAction("archive", member)}
      />
    </>
  );
}

function MemberSettingsMenuItems({
  member,
  memberLabel,
  affordances,
  chooseMemberAction,
}: {
  member: TeamMember;
  memberLabel: string;
  affordances: ReturnType<typeof buildMemberAffordances>;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
}) {
  return (
    <>
      {affordances.mayReset && (
        <MemberMenuItem
          testId="member-reset-password"
          label={m.settings_member_reset_password()}
          ariaLabel={m.settings_member_reset_password_aria({ member: memberLabel })}
          onSelect={() => chooseMemberAction("resetPassword", member)}
        />
      )}
      {member.mayRevokeSessions && (
        <MemberMenuItem
          testId="member-revoke-sessions"
          label={m.settings_member_revoke_sessions()}
          ariaLabel={m.settings_member_revoke_sessions_aria({ member: memberLabel })}
          onSelect={() => chooseMemberAction("revokeSessions", member)}
        />
      )}
      {affordances.mayChangeStatus && (
        <MemberStatusMenuItems member={member} memberLabel={memberLabel} chooseMemberAction={chooseMemberAction} />
      )}
      {affordances.mayRemove && (
        <MemberMenuItem
          testId="member-remove"
          label={m.settings_member_remove()}
          ariaLabel={m.settings_member_remove_aria({ member: memberLabel })}
          danger
          onSelect={() => chooseMemberAction("remove", member)}
        />
      )}
    </>
  );
}

// eslint-disable-next-line max-lines-per-function -- the row keeps the table cells and shared dialog wiring together.
export function MemberRow({
  member: member,
  myRole,
  signInTrackingEnabled,
  busy,
  openMenuFor,
  setOpenMenuFor,
  setRoleEdit,
  chooseMemberAction,
  linkedResourceIds,
  resourceCandidates,
  workspaceId,
  reload,
}: {
  member: TeamMember;
  myRole: Role | undefined;
  signInTrackingEnabled: boolean;
  busy: boolean;
  openMenuFor: string | null;
  setOpenMenuFor(value: string | null): void;
  setRoleEdit: Dispatch<SetStateAction<MemberRoleEdit | null>>;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
  linkedResourceIds: ReadonlySet<string>;
  resourceCandidates: readonly { resourceId: string; label: string }[];
  workspaceId: string | null;
  reload(): void;
}) {
  // One row renderer for both tables: the dialog's actions, the pencil's gate and the status badge are
  // identical wherever the row is drawn — only the grouping differs.
  // NB: the row var is `member`, NOT `m` — `m` is the imported i18n message catalogue
  // (P1.5.2); shadowing it would make `m.settings_*()` resolve against the Member.
  const affordances = buildMemberAffordances(myRole, member);
  const memberLabel = resolveMemberLabel(member);
  return (
    <tr
      className="border-b transition-colors last:border-b-0 hover:bg-accent/30 focus-within:bg-accent/30"
      data-testid="member-row"
    >
      <MemberIdentity member={member} />
      <td className="py-2 px-4 text-xs text-muted-foreground" data-testid="member-email">
        {member.email ?? m.settings_member_email_missing()}
      </td>
      <MemberResourceLink
        member={member}
        myRole={myRole}
        linkedResourceIds={linkedResourceIds}
        resourceCandidates={resourceCandidates}
        workspaceId={workspaceId}
        reload={reload}
      />
      {signInTrackingEnabled && (
        <td className="py-2 px-4 text-muted-foreground" data-testid="member-sign-in-confirmed">
          {member.signInConfirmed ? m.settings_member_sign_in_confirmed() : m.settings_member_sign_in_not_confirmed()}
        </td>
      )}
      <MemberPrimaryActions
        member={member}
        memberLabel={memberLabel}
        mayMasquerade={affordances.mayMasquerade}
        mayTouch={affordances.mayTouch}
        busy={busy}
        chooseMemberAction={chooseMemberAction}
        setRoleEdit={setRoleEdit}
        resourceLink={
          <MemberResourceDialog
            member={member}
            myRole={myRole}
            linkedResourceIds={linkedResourceIds}
            resourceCandidates={resourceCandidates}
            workspaceId={workspaceId}
            reload={reload}
            busy={busy}
          />
        }
        settingsMenu={
          <MemberActionsDialog
            memberLabel={memberLabel}
            hasExistingActions={affordances.hasMenu}
            busy={busy}
            open={openMenuFor === member.userId}
            onOpenChange={(open) => setOpenMenuFor(open ? member.userId : null)}
          >
            {affordances.mayTouch && (
              <MemberMenuItem
                testId="member-edit"
                label={m.settings_member_edit_aria({ member: memberLabel })}
                ariaLabel={m.settings_member_edit_aria({ member: memberLabel })}
                onSelect={() => {
                  setOpenMenuFor(null);
                  setRoleEdit({ member, nextRole: member.role });
                }}
              />
            )}
            <MemberSettingsMenuItems
              member={member}
              memberLabel={memberLabel}
              affordances={affordances}
              chooseMemberAction={chooseMemberAction}
            />
          </MemberActionsDialog>
        }
      />
    </tr>
  );
}
