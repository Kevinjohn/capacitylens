/* eslint-disable max-lines-per-function */
import { useId, useMemo, useState } from "react";
import type { Resource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import type { TeamMember } from "../../account/teamAccessClient";
import type { useMemberResourceLinkMutation } from "../settings/useMemberResourceLinkMutation";
import { Button } from "../ui/button";
import { Modal, SelectField } from "../common/ui";

export function LinkResourceDialog({
  resource,
  members,
  linkedMember,
  mutation,
  pending,
  error,
  onError,
  onSuccess,
  onClose,
}: {
  resource: Resource;
  accountId: string | null;
  members: readonly TeamMember[];
  linkedMember: TeamMember | undefined;
  mutation: ReturnType<typeof useMemberResourceLinkMutation>;
  pending: boolean;
  error: string | null;
  onError(value: string | null): void;
  onSuccess(): void;
  onClose(): void;
}) {
  const [memberId, setMemberId] = useState(linkedMember?.userId ?? "");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selectionErrorId = useId();
  const options = useMemo(
    () =>
      members
        .filter((member) => member.status === "active")
        .filter((member) => !member.resourceLink || member.userId === linkedMember?.userId)
        .map((member) => ({ value: member.userId, label: member.name ?? member.email ?? member.userId })),
    [members, linkedMember?.userId],
  );
  const submit = () => {
    if (!memberId) {
      const message = m.settings_resource_member_select_required();
      setSelectionError(message);
      onError(null);
      return;
    }
    if (!options.some((option) => option.value === memberId)) {
      const message = linkedMember ? m.settings_resource_member_replacement_stale() : m.settings_invite_person_stale();
      setSelectionError(message);
      onError(null);
      return;
    }
    const target = members.find((member) => member.userId === memberId);
    if (!target) {
      const message = linkedMember ? m.settings_resource_member_replacement_stale() : m.settings_invite_person_stale();
      setSelectionError(message);
      onError(null);
      return;
    }
    void mutation
      .mutate({
        principalId: memberId,
        resourceId: resource.id,
        expectedRevision: target.resourceLink?.revision ?? null,
        ...(linkedMember && linkedMember.userId !== memberId && linkedMember.resourceLink
          ? { replacePrincipalId: linkedMember.userId, replaceExpectedRevision: linkedMember.resourceLink.revision }
          : {}),
      })
      .then((result) => {
        if (result.kind === "ok") onSuccess();
      });
  };
  return (
    <Modal
      title={m.settings_resource_member_link_title({ resource: resource.name ?? resource.role })}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {m.settings_member_resource_cancel()}
          </Button>
          <Button type="submit" disabled={pending || options.length === 0 || memberId === ""}>
            {m.settings_resource_member_submit_link()}
          </Button>
        </>
      }
    >
      <SelectField
        label={m.settings_resource_member_member_label()}
        ariaLabel={m.settings_resource_member_member_aria({ resource: resource.name ?? resource.role })}
        value={memberId}
        onChange={(value) => {
          setMemberId(value);
          setSelectionError(null);
          onError(null);
        }}
        options={options}
        placeholder={m.settings_resource_member_select_required()}
        required
        invalid={selectionError !== null}
        describedById={selectionErrorId}
        disabled={pending}
      />
      {options.length === 0 && (
        <p className="text-sm text-muted-foreground">{m.settings_resource_member_no_members()}</p>
      )}
      {selectionError && (
        <p id={selectionErrorId} role="alert" className="text-sm text-danger">
          {selectionError}
        </p>
      )}
      {error && !selectionError && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
