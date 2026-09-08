import { m } from "@/i18n";
import { formatInstant } from "../../lib/dateDisplay";
import { useStore } from "../../store/useStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Switch } from "../ui/switch";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CopyableLinkBlock, InviteMemberPanel } from "./InviteMemberPanel";
import { MemberConfirmations } from "./MemberConfirmations";
import { MemberRow } from "./MemberRow";
import { SsoReadinessPanel } from "./SsoReadinessPanel";
import { useMembersOrchestration } from "./useMembersOrchestration";
import type { TeamMember } from "../../account/teamAccessClient";

// Member-management section shown in Team & access on an auth-enabled, server-backed deploy.
// Owner/Admin list members in a table (name / email / optional sign-in confirmation), change a member's role through the
// row's pencil, reach the rarer lifecycle actions through the row's gear, and invite people from a
// SEPARATE card below (#175). Ownership transfer is deliberately absent: it is not a per-row action
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
      <MembersCard orchestration={orchestration} setActionStatusElement={setActionStatusElement} />
      {/* Inviting someone is its own job, not a footnote to the member table (#175): it lives in a
          separate card together with the invites that are still outstanding. */}
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
        />
      )}
      <MemberConfirmations
        memberConfirmation={orchestration.memberConfirmation}
        setMemberConfirmation={orchestration.setMemberConfirmation}
        confirmedMemberAction={orchestration.confirmedMemberAction}
        roleEdit={orchestration.roleEdit}
        setRoleEdit={orchestration.setRoleEdit}
        roleOptions={orchestration.roleOptions}
        busy={orchestration.busyAction !== null}
        changeRole={orchestration.changeRole}
        unlinkRepair={orchestration.unlinkRepair}
        setUnlinkRepair={orchestration.setUnlinkRepair}
        removeIncorrectSsoLink={orchestration.removeIncorrectSsoLink}
      />
    </>
  );
}

type MembersOrchestration = Omit<ReturnType<typeof useMembersOrchestration>, "setActionStatusElement">;

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
  signInTrackingEnabled,
  orchestration,
}: {
  rows: TeamMember[];
  testId: string;
  signInTrackingEnabled: boolean;
  orchestration: MembersOrchestration;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid={testId}>
        <thead>
          <tr className="border-b text-left text-xs font-medium text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              {m.settings_member_col_name()}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {m.settings_member_col_email()}
            </th>
            {signInTrackingEnabled && (
              <th scope="col" className="py-2 pr-3 font-medium">
                {m.settings_member_col_sign_in_confirmed()}
              </th>
            )}
            <th scope="col" className="w-10 py-2 pl-8 text-right font-medium">
              <span className="sr-only">{m.settings_member_col_edit()}</span>
            </th>
            <th scope="col" className="w-10 py-2 pl-2 text-right font-medium">
              <span className="sr-only">{m.settings_member_col_settings()}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              myRole={orchestration.myRole}
              signInTrackingEnabled={signInTrackingEnabled}
              busy={orchestration.busyAction !== null}
              openMenuFor={orchestration.openMenuFor}
              setOpenMenuFor={orchestration.setOpenMenuFor}
              setRoleEdit={orchestration.setRoleEdit}
              chooseMemberAction={orchestration.chooseMemberAction}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReadinessPanels({ orchestration }: { orchestration: MembersOrchestration }) {
  return (
    <>
      {orchestration.readinessApplies && orchestration.readinessError && (
        <section
          className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 p-3"
          data-testid="sso-readiness-error"
          role="alert"
        >
          <h3 className="text-sm font-medium text-danger">{m.settings_sso_readiness_heading()}</h3>
          <p className="text-xs text-danger">{m.settings_sso_readiness_error()}</p>
        </section>
      )}
      {orchestration.readinessApplies && orchestration.readiness && (
        <SsoReadinessPanel
          authMode={orchestration.authMode}
          readiness={orchestration.readiness}
          busy={orchestration.busyAction !== null}
          emailRepair={orchestration.emailRepair}
          setEmailRepair={orchestration.setEmailRepair}
          error={orchestration.error}
          errorField={orchestration.errorField}
          errorId={orchestration.errorId}
          onCorrectEmail={() => void orchestration.correctSsoEmail()}
          onRemoveLink={(member, link) => orchestration.setUnlinkRepair({ member, link })}
        />
      )}
    </>
  );
}

function MemberDirectory({
  orchestration,
  members,
  signInTrackingEnabled,
}: {
  orchestration: MembersOrchestration;
  members: TeamMember[];
  signInTrackingEnabled: boolean;
}) {
  let activeContent = null;
  if (members.length === 0)
    activeContent = <p className="py-2 text-sm text-muted-foreground">{m.settings_members_empty()}</p>;
  else if (orchestration.activeMembers)
    activeContent = (
      <MembersTable
        rows={orchestration.activeMembers}
        testId="members-table"
        signInTrackingEnabled={signInTrackingEnabled}
        orchestration={orchestration}
      />
    );
  let disclosureIcon = <ChevronRight data-icon="inline-start" />;
  if (orchestration.inactiveOpen) disclosureIcon = <ChevronDown data-icon="inline-start" />;
  return (
    <>
      {activeContent}
      {orchestration.inactiveMembers.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 self-start text-sm font-medium text-brand underline-offset-2 hover:underline"
            aria-expanded={orchestration.inactiveOpen}
            aria-controls="members-inactive"
            data-testid="members-inactive-toggle"
            onClick={() => orchestration.setInactiveOpen((open) => !open)}
          >
            {disclosureIcon}
            {m.settings_members_inactive_group({ count: orchestration.inactiveMembers.length })}
          </button>
          {orchestration.inactiveOpen && (
            <div id="members-inactive">
              <MembersTable
                rows={orchestration.inactiveMembers}
                testId="members-inactive-table"
                signInTrackingEnabled={signInTrackingEnabled}
                orchestration={orchestration}
              />
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ResetLink({ orchestration }: { orchestration: MembersOrchestration }) {
  if (!orchestration.resetLink) return null;
  return (
    <CopyableLinkBlock
      link={orchestration.resetLink.link}
      testId="reset-link"
      copiedNotice={m.settings_members_reset_copied()}
      copyLabel={m.settings_reset_copy_aria({ member: orchestration.resetLink.member })}
      copyLink={orchestration.copyLink}
      intro={
        <p className="text-xs text-muted-foreground">
          {m.settings_members_reset_intro({
            member: orchestration.resetLink.member,
            when: formatInstant(orchestration.resetLink.expiresAt),
          })}
        </p>
      }
    />
  );
}

function MembersCard({
  orchestration,
  setActionStatusElement,
}: {
  orchestration: MembersOrchestration;
  setActionStatusElement(element: HTMLParagraphElement | null): void;
}) {
  if (orchestration.directory.kind !== "ready") return null;
  const { members, signInTrackingEnabled } = orchestration.directory.snapshot;
  return (
    <Card data-testid="members-section" aria-busy={orchestration.busyAction !== null}>
      <CardHeader>
        <CardTitle>
          <h2>{m.settings_members_heading()}</h2>
        </CardTitle>
        <CardDescription>{m.settings_members_intro()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p ref={setActionStatusElement} role="status" aria-live="polite" tabIndex={-1} className="sr-only">
          {orchestration.busyAction ? m.settings_members_updating() : ""}
        </p>
        <FieldError id={orchestration.errorId}>
          {orchestration.errorField === null ? orchestration.error : null}
        </FieldError>
        <ReadinessPanels orchestration={orchestration} />
        {orchestration.mayManageSignInTracking && (
          <Field orientation="horizontal" data-disabled={orchestration.busyAction !== null || undefined}>
            <FieldContent>
              <FieldLabel htmlFor="member-sign-in-tracking">{m.settings_members_sign_in_tracking_label()}</FieldLabel>
              <FieldDescription>{m.settings_members_sign_in_tracking_description()}</FieldDescription>
            </FieldContent>
            <Switch
              id="member-sign-in-tracking"
              data-testid="member-sign-in-tracking"
              checked={signInTrackingEnabled}
              disabled={orchestration.busyAction !== null}
              onCheckedChange={(next) => void orchestration.changeSignInTracking({ next: next })}
            />
          </Field>
        )}
        <MemberDirectory
          orchestration={orchestration}
          members={members}
          signInTrackingEnabled={signInTrackingEnabled}
        />
        <ResetLink orchestration={orchestration} />
      </CardContent>
    </Card>
  );
}
