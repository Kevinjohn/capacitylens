import { m } from "@/i18n";
import { formatInstant } from "../../lib/dateDisplay";
import { useStore } from "../../store/useStore";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { FieldError } from "../ui/field";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CopyableLinkBlock, InviteMemberPanel } from "./InviteMemberPanel";
import { MemberConfirmations } from "./MemberConfirmations";
import { MemberRow } from "./MemberRow";
import { useMembersOrchestration } from "./useMembersOrchestration";
import type { TeamMember } from "../../account/teamAccessClient";

// Member-management section shown in Team & access on an auth-enabled, server-backed deploy.
// Owner/Admin list members in a compact managed-row table (name / email / optional sign-in confirmation), change a member's role through the
// row's pencil, reach the rarer lifecycle actions and Resource link through the centered member-actions dialog, and invite people from a
// separate dialog above. Ownership transfer is deliberately absent: it is not a per-row action
// and returns as its own owner-only section under a follow-up ticket. The CLIENT
// gate is courtesy only — the SAME pure guards (canEditAnyMemberRole / canRemoveMember) hide controls
// the user can't use, but the SERVER is the backstop (every route is gated server-side; a 403 on the
// initial members fetch is what hides the whole section for a viewer/editor). The invite TOKEN is
// shown exactly ONCE, straight from the create response — it is write-once and never read back.

/**
 * The Team & access member-management section. Renders ONLY in server + auth-on mode; a 403 on the initial
 * members read self-gates it away for a viewer/editor (renders nothing). Owner/Admin affordances are
 * gated client-side via the shared pure guards (Owner actions hidden for an Admin; Owner membership
 * stays outside ordinary role/removal controls). The server enforces all of it regardless.
 */
export function MembersSection() {
  const activeAccountId = useStore((state) => state.activeAccountId);
  return <AccountMembersSection key={activeAccountId ?? "no-active-account"} activeAccountId={activeAccountId} />;
}

/** Account-keyed implementation. Changing companies remounts this boundary, which discards
 * account-local drafts, confirmations, action locks and write-once bearer links together. */
function AccountMembersSection({ activeAccountId }: { activeAccountId: string | null }) {
  const { setActionStatusElement, ...orchestration } = useMembersOrchestration(activeAccountId);

  if (!orchestration.enabled) return null; // OFF / demo build: the section does not exist.
  // Privileged controls stay fail-closed until the current account's members read authorizes this
  // section. A 403 remains hidden, and a switch cannot briefly expose the next account's form while
  // its authorization request is still pending.
  if (orchestration.directory.kind === "loading" || orchestration.directory.kind === "hidden") return null;
  if (orchestration.directory.kind === "error") {
    return (
      <MembersErrorCard errorId={orchestration.errorId} error={orchestration.error} reload={orchestration.reload} />
    );
  }
  const { invites } = orchestration.directory.snapshot;
  return (
    <>
      {/* Inviting someone is its own job, not a footnote to the member table (#175): the form opens
          in a centered dialog and outstanding invites stay in their own bordered section. */}
      {orchestration.mayManageInvites && (
        <InviteMemberPanel
          authMode={orchestration.authMode}
          busy={orchestration.busyAction !== null}
          inviteRole={orchestration.inviteRole}
          setInviteRole={orchestration.setInviteRole}
          invitationPreauthorizedEmail={orchestration.invitationPreauthorizedEmail}
          setInvitationPreauthorizedEmail={orchestration.setInvitationPreauthorizedEmail}
          error={orchestration.error}
          errorField={orchestration.errorField}
          errorId={orchestration.errorId}
          clear={orchestration.clear}
          mintedLink={orchestration.mintedLink}
          copyLink={orchestration.copyLink}
          submitInvite={orchestration.submitInvite}
          invites={invites}
          renderedAt={orchestration.renderedAt}
          revokeInvite={orchestration.revokeInvite}
          roleOptions={orchestration.roleOptions}
          invitationPeople={orchestration.invitationPeople}
          invitationResourceId={orchestration.invitationResourceId}
          setInvitationResourceId={orchestration.setInvitationResourceId}
        />
      )}
      <MembersDirectorySection members={orchestration} setActionStatusElement={setActionStatusElement} />
      <MemberConfirmations
        memberConfirmation={orchestration.memberConfirmation}
        setMemberConfirmation={orchestration.setMemberConfirmation}
        confirmedMemberAction={orchestration.confirmedMemberAction}
        roleEdit={orchestration.roleEdit}
        setRoleEdit={orchestration.setRoleEdit}
        roleOptions={orchestration.roleOptions}
        busy={orchestration.busyAction !== null}
        changeRole={orchestration.changeRole}
      />
    </>
  );
}

type MembersOrchestration = Omit<ReturnType<typeof useMembersOrchestration>, "setActionStatusElement">;
type MemberTableCapabilities = Pick<
  MembersOrchestration,
  | "myRole"
  | "busyAction"
  | "openMenuFor"
  | "setOpenMenuFor"
  | "setRoleEdit"
  | "chooseMemberAction"
  | "reload"
  | "activeAccountId"
  | "resourceCandidates"
  | "error"
  | "errorField"
  | "errorId"
>;
type DirectoryCapabilities = MemberTableCapabilities &
  Pick<MembersOrchestration, "activeMembers" | "inactiveMembers" | "inactiveOpen" | "setInactiveOpen">;
type ResetLinkCapabilities = Pick<MembersOrchestration, "resetLink" | "copyLink">;
type MembersDirectoryCapabilities = DirectoryCapabilities &
  ResetLinkCapabilities &
  Pick<MembersOrchestration, "directory" | "mayManageSignInTracking" | "changeSignInTracking">;

function MembersErrorCard({ errorId, error, reload }: { errorId: string; error: string | null; reload(): void }) {
  return (
    <Card data-testid="members-section">
      <CardHeader>
        <CardTitle>
          <h2>{m.settings_members_heading()}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <FieldError id={errorId}>{error}</FieldError>
        <Button type="button" variant="outline" size="sm" onClick={reload}>
          {m.settings_members_retry()}
        </Button>
      </CardContent>
    </Card>
  );
}

function MembersTable({
  rows,
  testId,
  memberActions,
  allMembers,
}: {
  rows: TeamMember[];
  testId: string;
  memberActions: MemberTableCapabilities;
  allMembers: TeamMember[];
}) {
  const linkedResourceIds = new Set(
    allMembers.flatMap((candidate) => (candidate.resourceLink ? [candidate.resourceLink.resourceId] : [])),
  );
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm" data-testid={testId}>
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
            <th scope="col" className="w-auto py-2 px-4 text-right font-medium">
              {m.settings_member_col_actions()}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              myRole={memberActions.myRole}
              busy={memberActions.busyAction !== null}
              openMenuFor={memberActions.openMenuFor}
              setOpenMenuFor={memberActions.setOpenMenuFor}
              setRoleEdit={memberActions.setRoleEdit}
              chooseMemberAction={memberActions.chooseMemberAction}
              linkedResourceIds={linkedResourceIds}
              resourceCandidates={memberActions.resourceCandidates}
              workspaceId={memberActions.activeAccountId}
              reload={memberActions.reload}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberDirectory({ directory, members }: { directory: DirectoryCapabilities; members: TeamMember[] }) {
  let activeContent = null;
  if (members.length === 0)
    activeContent = <p className="py-2 text-sm text-muted-foreground">{m.settings_members_empty()}</p>;
  else if (directory.activeMembers)
    activeContent = (
      <MembersTable
        rows={directory.activeMembers}
        testId="members-table"
        memberActions={directory}
        allMembers={members}
      />
    );
  let disclosureIcon = <ChevronRight data-icon="inline-start" />;
  if (directory.inactiveOpen) disclosureIcon = <ChevronDown data-icon="inline-start" />;
  return (
    <>
      {activeContent}
      {directory.inactiveMembers.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 self-start text-sm font-medium text-brand underline-offset-2 hover:underline"
            aria-expanded={directory.inactiveOpen}
            aria-controls="members-inactive"
            data-testid="members-inactive-toggle"
            onClick={() => directory.setInactiveOpen((open) => !open)}
          >
            {disclosureIcon}
            {m.settings_members_inactive_group({ count: directory.inactiveMembers.length })}
          </button>
          {directory.inactiveOpen && (
            <div id="members-inactive">
              <MembersTable
                rows={directory.inactiveMembers}
                testId="members-inactive-table"
                memberActions={directory}
                allMembers={members}
              />
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ResetLink({ reset }: { reset: ResetLinkCapabilities }) {
  if (!reset.resetLink) return null;
  return (
    <CopyableLinkBlock
      link={reset.resetLink.link}
      testId="reset-link"
      copiedNotice={m.settings_members_reset_copied()}
      copyLabel={m.settings_reset_copy_aria({ member: reset.resetLink.member })}
      copyLink={reset.copyLink}
      intro={
        <p className="text-xs text-muted-foreground">
          {m.settings_members_reset_intro({
            member: reset.resetLink.member,
            when: formatInstant(reset.resetLink.expiresAt),
          })}
        </p>
      }
    />
  );
}

function MembersDirectorySection({
  members,
  setActionStatusElement,
}: {
  members: MembersDirectoryCapabilities;
  setActionStatusElement(element: HTMLParagraphElement | null): void;
}) {
  if (members.directory.kind !== "ready") return null;
  const { members: memberRows } = members.directory.snapshot;
  return (
    <section data-testid="members-section" aria-busy={members.busyAction !== null} className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h2 className="font-semibold">{m.settings_members_heading()}</h2>
        <p className="text-sm text-muted-foreground">{m.settings_members_intro()}</p>
      </header>
      <div className="flex flex-col gap-4">
        <p ref={setActionStatusElement} role="status" aria-live="polite" tabIndex={-1} className="sr-only">
          {members.busyAction ? m.settings_members_updating() : ""}
        </p>
        <FieldError id={members.errorId}>{members.errorField === null ? members.error : null}</FieldError>
        <MemberDirectory directory={members} members={memberRows} />
        <ResetLink reset={members} />
      </div>
    </section>
  );
}
