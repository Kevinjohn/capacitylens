import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { m } from '@/i18n';
import { can } from '@capacitylens/shared/domain/access';
import type { Role } from '@capacitylens/shared/domain/access';
import type { TeamMember } from '@/account/teamAccessClient';
import { resolveRoleLabel } from '@/lib/accessCopy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye, Pencil } from 'lucide-react';
import type { MemberRoleEdit } from './MemberConfirmations';
import { resolveMemberLabel } from './memberConfirmationCopy';
import type { MemberConfirmationAction } from './memberConfirmationCopy';
import { MemberResourceDialog, MemberResourceLink } from './MemberResourceLink';
import { MemberActionsDialog } from './MemberActionsDialog';

// The server decides `manage` with the Access Control package and authorizes each operation again.
function buildMemberAffordances(
  myRole: Role | undefined,
  member: TeamMember,
): { mayMasquerade: boolean; mayTouch: boolean; hasMenu: boolean } {
  const active = member.status === 'active';
  return {
    mayMasquerade: active && !member.isSelf && !!myRole && can(myRole, 'viewAs:use'),
    mayTouch: active && member.manage,
    hasMenu: member.manage,
  };
}

// Use ordinary buttons inside the dialog to avoid nesting another menu and focus model.
function MemberMenuItem({
  label,
  ariaLabel,
  testId,
  onSelect,
}: {
  label: string;
  ariaLabel: string;
  testId: string;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
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

  const statusLabels = member.status === 'suspended' ? [m.settings_member_status_suspended()] : [];

  return (
    <td className="py-2 px-4">
      <div className="flex flex-col items-start gap-1">
        <span className="text-ink">
          {name}
          {member.isSelf && (
            <span className="ml-1 text-xs text-muted-foreground">{m.settings_member_you()}</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {statusLabels.map((label) => (
            <Badge key={label} variant="outline" data-testid="member-status">
              {label}
            </Badge>
          ))}
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
            onClick={() => chooseMemberAction('masquerade', member)}
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

function MemberSettingsMenuItems({
  member,
  memberLabel,
  chooseMemberAction,
}: {
  member: TeamMember;
  memberLabel: string;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
}) {
  return member.status === 'active' ? (
    <MemberMenuItem
      testId="member-suspend"
      label={m.settings_member_suspend()}
      ariaLabel={m.settings_member_suspend_aria({ member: memberLabel })}
      onSelect={() => chooseMemberAction('suspend', member)}
    />
  ) : (
    <MemberMenuItem
      testId="member-restore"
      label={m.settings_member_restore()}
      ariaLabel={m.settings_member_restore_aria({ member: memberLabel })}
      onSelect={() => chooseMemberAction('restore', member)}
    />
  );
}

/** Shows one member's role, sign-in state, and permitted management actions. */
export function MemberRow({
  member: member,
  myRole,
  busy,
  openMenuFor,
  setOpenMenuFor,
  setRoleEdit,
  chooseMemberAction,
  linkedResourceIds,
  resourceCandidates,
  workspaceId,
  reload,
  acceptedReadGeneration,
}: {
  member: TeamMember;
  myRole: Role | undefined;
  busy: boolean;
  openMenuFor: string | null;
  setOpenMenuFor(value: string | null): void;
  setRoleEdit: Dispatch<SetStateAction<MemberRoleEdit | null>>;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
  linkedResourceIds: ReadonlySet<string>;
  resourceCandidates: readonly { resourceId: string; label: string }[];
  workspaceId: string | null;
  reload(): number;
  acceptedReadGeneration: number;
}) {
  const affordances = buildMemberAffordances(myRole, member);
  const memberLabel = resolveMemberLabel(member);
  return (
    <tr
      className="border-b transition-colors last:border-b-0 hover:bg-accent/30 focus-within:bg-accent/30"
      data-testid="member-row"
    >
      <MemberIdentity member={member} />
      <td className="py-2 px-4 text-sm text-ink" data-testid="member-role">
        {member.role === 'owner'
          ? m.settings_member_sole_owner_protected()
          : resolveRoleLabel(member.role)}
      </td>
      <td className="max-w-52 py-2 px-4 text-xs text-muted-foreground" data-testid="member-email">
        <span className="block truncate" title={member.email ?? undefined}>
          {member.email ?? m.settings_member_email_missing()}
        </span>
      </td>
      <MemberResourceLink
        member={member}
        myRole={myRole}
        linkedResourceIds={linkedResourceIds}
        resourceCandidates={resourceCandidates}
      />
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
            acceptedReadGeneration={acceptedReadGeneration}
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
            {member.manage && (
              <MemberSettingsMenuItems
                member={member}
                memberLabel={memberLabel}
                chooseMemberAction={chooseMemberAction}
              />
            )}
          </MemberActionsDialog>
        }
      />
    </tr>
  );
}
