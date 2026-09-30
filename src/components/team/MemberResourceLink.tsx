import { useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import type { Role } from "@capacitylens/shared/domain/access";
import type { TeamMember } from "@/account/teamAccessClient";
import { Modal, SelectField } from "@/components/common/ui";
import { Button } from "@/components/ui/button";
import { Link as LinkIcon } from "lucide-react";
import { useMemberResourceLinkRequest } from "./useMemberResourceLinkRequest";

function resolveExceptionMessage(exception: TeamMember["resourceLinkException"]): string | null {
  if (!exception) return null;
  if (exception.reason === "resource_already_linked") return m.settings_member_resource_attention_occupied();
  if (exception.reason === "member_already_linked") return m.settings_member_resource_attention_member_linked();
  return m.settings_member_resource_attention_unavailable();
}

interface MemberResourceLinkProps {
  member: TeamMember;
  myRole: Role | undefined;
  linkedResourceIds: ReadonlySet<string>;
  resourceCandidates: readonly { resourceId: string; label: string }[];
  workspaceId: string | null;
  reload(): void;
  /** Render inside the centered resource-link dialog instead of a table cell. */
  dialog?: boolean;
}

type MemberResourceView = ReturnType<typeof buildMemberResourceView>;

/** A link whose person is missing from the candidates, archived or disabled is retained but inactive. */
function isLinkedPersonInactive(link: TeamMember["resourceLink"], listed: boolean): boolean {
  if (!link) return false;
  return !listed || link.resourceStatus === "archived" || link.resourceStatus === "disabled";
}

function isMemberLinkEditable(member: TeamMember): boolean {
  return member.status === "active" && !member.accessDisabled && member.membershipPresent !== false;
}

/** What the cell and the editor show for one member, derived from the member and the candidates. */
function buildMemberResourceView(
  member: TeamMember,
  linkedResourceIds: ReadonlySet<string>,
  resourceCandidates: MemberResourceLinkProps["resourceCandidates"],
) {
  const linkedId = member.resourceLink?.resourceId;
  const currentPerson = resourceCandidates.find((resource) => resource.resourceId === linkedId);
  const people = resourceCandidates
    .filter((resource) => !linkedResourceIds.has(resource.resourceId) || resource.resourceId === linkedId)
    .map((resource) => ({ id: resource.resourceId, name: resource.label }));
  const currentPersonInactive = isLinkedPersonInactive(member.resourceLink, currentPerson !== undefined);
  return {
    people,
    memberLabel: member.name ?? member.email ?? member.userId,
    currentPersonLabel:
      currentPerson?.label ?? member.resourceLink?.resourceName ?? m.settings_member_resource_default_person(),
    // A retained link to an archived or disabled person is shown, never offered as a choice.
    showInactive: currentPersonInactive,
    canEdit: isMemberLinkEditable(member) && !currentPersonInactive && people.length > 0,
    exceptionMessage: resolveExceptionMessage(member.resourceLinkException),
  };
}

/** Account-admin control linking a login member to one eligible person Resource. */
export function MemberResourceLink(props: MemberResourceLinkProps) {
  const { member, myRole, linkedResourceIds, resourceCandidates, dialog = false } = props;
  if (myRole !== "owner" && myRole !== "admin") return dialog ? <div /> : <td className="py-2 px-4" />;
  const view = buildMemberResourceView(member, linkedResourceIds, resourceCandidates);
  // The row icon opens the editor directly. The non-dialog cell remains a compact status-only
  // view, while the centered dialog starts with its selector ready for the requested change.
  if (!dialog) return <MemberResourceCell linked={Boolean(member.resourceLink)} view={view} />;
  return <MemberResourceEditor {...props} view={view} />;
}

function MemberResourceCell({ linked, view }: { linked: boolean; view: MemberResourceView }) {
  return (
    <td className="py-2 px-4" data-testid="member-resource-cell">
      <div className="flex flex-col items-start gap-1">
        <span className="text-xs text-muted-foreground" aria-live="polite" data-testid="member-resource-status">
          {linked ? view.currentPersonLabel : m.settings_member_resource_not_linked()}
        </span>
        {view.exceptionMessage && (
          <span className="text-xs text-warn">
            {m.settings_member_resource_attention_heading()}: {view.exceptionMessage}
          </span>
        )}
        {view.showInactive && (
          <span className="text-xs text-muted-foreground">
            {m.settings_member_resource_inactive({ name: view.currentPersonLabel })}
          </span>
        )}
      </div>
    </td>
  );
}

function MemberResourceException({
  message,
  canEdit,
  disabled,
  onChooseAnother,
  onDismiss,
}: {
  message: string;
  canEdit: boolean;
  disabled: boolean;
  onChooseAnother(): void;
  onDismiss(): void;
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded border border-warn/40 bg-warn/5 p-2 text-xs">
      <strong className="font-medium text-ink">{m.settings_member_resource_attention_heading()}</strong>
      <span>{message}</span>
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onChooseAnother}>
            {m.settings_member_resource_choose_another()}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onDismiss}>
          {m.settings_member_resource_dismiss()}
        </Button>
      </div>
    </div>
  );
}

function MemberResourceEditor({
  member,
  workspaceId,
  reload,
  view,
}: MemberResourceLinkProps & { view: MemberResourceView }) {
  const { pending, error, statusMessage, change, dismissException } = useMemberResourceLinkRequest({
    member,
    workspaceId,
    reload,
  });
  const selectorScopeRef = useRef<HTMLDivElement>(null);
  const disabled = pending || !workspaceId;
  return (
    <div ref={selectorScopeRef} className="flex flex-col items-start gap-2">
      {view.exceptionMessage && (
        <MemberResourceException
          message={view.exceptionMessage}
          canEdit={view.canEdit}
          disabled={disabled}
          onChooseAnother={() =>
            selectorScopeRef.current?.querySelector<HTMLElement>('[data-testid="member-resource-link"]')?.focus()
          }
          onDismiss={dismissException}
        />
      )}
      {view.showInactive && (
        <span className="text-xs text-muted-foreground">
          {m.settings_member_resource_inactive({ name: view.currentPersonLabel })}
        </span>
      )}
      {view.canEdit && (
        <SelectField
          label={m.settings_member_col_scheduled_person()}
          ariaLabel={m.settings_member_resource_choose_aria({ member: view.memberLabel })}
          testId="member-resource-link"
          autoFocus
          layout="label-control"
          disabled={disabled}
          value={member.resourceLink?.resourceId ?? ""}
          options={[
            { value: "", label: m.settings_member_resource_unlinked() },
            ...view.people.map((person) => ({ value: person.id, label: person.name })),
          ]}
          onChange={(resourceId) => {
            change(resourceId);
          }}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {member.resourceLink && (
          <Button
            type="button"
            size="sm"
            variant="danger-soft"
            disabled={disabled}
            aria-label={m.settings_member_resource_remove_aria({ member: view.memberLabel })}
            onClick={() => change("")}
          >
            {m.settings_member_resource_remove()}
          </Button>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {pending ? m.settings_members_updating() : statusMessage}
      </span>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Row action that opens the resource-link editor without mixing it into lifecycle settings. */
export function MemberResourceDialog({
  member,
  myRole,
  linkedResourceIds,
  resourceCandidates,
  workspaceId,
  reload,
  busy,
}: {
  member: TeamMember;
  myRole: Role | undefined;
  linkedResourceIds: ReadonlySet<string>;
  resourceCandidates: readonly { resourceId: string; label: string }[];
  workspaceId: string | null;
  reload(): void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) requestAnimationFrame(() => triggerRef.current?.focus());
    wasOpen.current = open;
  }, [open]);
  if (member.membershipPresent === false || (myRole !== "owner" && myRole !== "admin")) return null;
  const memberLabel = member.name ?? member.email ?? member.userId;
  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size="icon-sm"
        variant="outline"
        title={m.settings_member_resource_link_aria({ member: memberLabel })}
        aria-label={m.settings_member_resource_link_aria({ member: memberLabel })}
        data-testid="member-resource-menu"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <LinkIcon />
      </Button>
      {open && (
        <Modal
          title={m.settings_member_col_scheduled_person()}
          description={memberLabel}
          onClose={() => setOpen(false)}
          guardDirty={false}
          footer={
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              {m.settings_help_close()}
            </Button>
          }
        >
          <MemberResourceLink
            member={member}
            myRole={myRole}
            linkedResourceIds={linkedResourceIds}
            resourceCandidates={resourceCandidates}
            workspaceId={workspaceId}
            reload={reload}
            dialog
          />
        </Modal>
      )}
    </>
  );
}
