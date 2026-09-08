import type { Dispatch, SetStateAction } from "react";
import { m } from "@/i18n";
import type { Role } from "@capacitylens/shared/domain/access";
import type { TeamMember } from "../../account/teamAccessClient";
import { buildMemberConfirmationCopy, resolveMemberLabel, type MemberConfirmation } from "./memberConfirmationCopy";

export type { MemberConfirmation, MemberConfirmationAction } from "./memberConfirmationCopy";
import { resolveRoleSummary } from "../../lib/accessCopy";
import { ConfirmDialog, Modal, SelectField } from "../common/ui";
import { Button } from "../ui/button";
import { resolveReadinessMemberLabel, type ReadinessMember, type ReadinessRepairLink } from "./ssoReadiness";

export type MemberRoleEdit = { member: TeamMember; nextRole: Role };
export type UnlinkRepair = { member: ReadinessMember; link: ReadinessRepairLink };

type MemberConfirmationsProps = {
  memberConfirmation: MemberConfirmation | null;
  setMemberConfirmation: Dispatch<SetStateAction<MemberConfirmation | null>>;
  confirmedMemberAction(): void;
  roleEdit: MemberRoleEdit | null;
  setRoleEdit: Dispatch<SetStateAction<MemberRoleEdit | null>>;
  roleOptions: { value: Role; label: string }[];
  busy: boolean;
  changeRole(member: TeamMember, role: Role): Promise<void>;
  unlinkRepair: UnlinkRepair | null;
  setUnlinkRepair: Dispatch<SetStateAction<UnlinkRepair | null>>;
  removeIncorrectSsoLink(member: ReadinessMember, link: ReadinessRepairLink): Promise<void>;
};

function MemberRoleEditDialog({
  roleEdit,
  setRoleEdit,
  roleOptions,
  busy,
  changeRole,
}: {
  roleEdit: MemberRoleEdit;
  setRoleEdit: Dispatch<SetStateAction<MemberRoleEdit | null>>;
  roleOptions: { value: Role; label: string }[];
  busy: boolean;
  changeRole(member: TeamMember, role: Role): Promise<void>;
}) {
  return (
    <Modal
      title={m.settings_change_role_title()}
      onClose={() => setRoleEdit(null)}
      onSubmit={() => {
        setRoleEdit(null);
        void changeRole(roleEdit.member, roleEdit.nextRole);
      }}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => setRoleEdit(null)}>
            {m.form_cancel()}
          </Button>
          <Button type="submit" size="sm" data-testid="member-role-save" disabled={busy}>
            {m.settings_member_role_save()}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{resolveMemberLabel(roleEdit.member)}</p>
      <span data-testid="member-role-select">
        <SelectField
          label={m.settings_member_role_label()}
          ariaLabel={m.settings_member_role_aria({ member: resolveMemberLabel(roleEdit.member) })}
          value={roleEdit.nextRole}
          onChange={(value) => setRoleEdit((current) => (current ? { ...current, nextRole: value as Role } : current))}
          options={roleOptions}
          disabled={busy}
        />
      </span>
      <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="member-role-summary">
        {resolveRoleSummary(roleEdit.nextRole)}
      </p>
    </Modal>
  );
}

export function MemberConfirmations({
  memberConfirmation,
  setMemberConfirmation,
  confirmedMemberAction,
  roleEdit,
  setRoleEdit,
  roleOptions,
  busy,
  changeRole,
  unlinkRepair,
  setUnlinkRepair,
  removeIncorrectSsoLink,
}: MemberConfirmationsProps) {
  const copy = memberConfirmation ? buildMemberConfirmationCopy(memberConfirmation) : null;
  return (
    <>
      {memberConfirmation && copy && (
        <ConfirmDialog
          title={copy.title}
          confirmLabel={copy.confirmLabel}
          message={copy.message}
          onConfirm={confirmedMemberAction}
          onCancel={() => setMemberConfirmation(null)}
        />
      )}
      {/* The pencil's editor. Role only, by design (#175): everything else a member's row can do
          lives behind the gear, and ownership is not a row-level action at all. */}
      {roleEdit && (
        <MemberRoleEditDialog
          roleEdit={roleEdit}
          setRoleEdit={setRoleEdit}
          roleOptions={roleOptions}
          busy={busy}
          changeRole={changeRole}
        />
      )}
      {unlinkRepair && (
        <ConfirmDialog
          title={m.settings_sso_remove_link_title()}
          confirmLabel={m.settings_sso_remove_link()}
          message={m.settings_sso_remove_link_message({ member: resolveReadinessMemberLabel(unlinkRepair.member) })}
          onConfirm={() => {
            const pending = unlinkRepair;
            setUnlinkRepair(null);
            void removeIncorrectSsoLink(pending.member, pending.link);
          }}
          onCancel={() => setUnlinkRepair(null)}
        />
      )}
    </>
  );
}
