# US-TEAM-06 — Change a member's role or access

As an Owner or Admin, I want to change an eligible member's role or active status so that company access matches their responsibilities.

**Status:** Current
**Access:** Owner or Admin; own membership and the Owner are not manageable
**Entry:** Team & access → Members → member actions
**Documentation:** [Invite teammates](../../docs-src/admin/invite-teammates.md#change-a-members-role-or-schedule-row); [Stop access](../../docs-src/admin/invite-teammates.md#stop-access)
**Source:** [MemberConfirmations.tsx](../../apps/frontend/src/components/team/MemberConfirmations.tsx); [MemberRow.tsx](../../apps/frontend/src/components/team/MemberRow.tsx)

## Acceptance criteria

| Field       | Control | Required/default/conditions                                              |
| ----------- | ------- | ------------------------------------------------------------------------ |
| Member role | Select  | Required; starts with the member's current role. Owner is not an option. |

- **Edit {member}** opens **Change member role?** with the Member role select and a summary of the selected role; **Save role** applies it and **Cancel** keeps the current role.
- **Suspend** asks for confirmation and explains that access stops while role and history remain. **Restore membership** asks for confirmation and restores the member with the previous role.
- Active members appear in Members; suspended members appear under **No longer active**. Nobody can change their own membership or the Owner through these controls.

## User flow

```mermaid
flowchart TD
    Open["Open Members and choose an eligible member"] --> Change{"Change role or active status?"}
    Change -->|"Role"| Edit["Select Edit, choose a role and Save role"]
    Edit --> Updated["Review the updated member row"]
    Change -->|"Status"| Menu["Open More actions"]
    Menu --> Suspend["Select Suspend and confirm"]
    Menu --> Restore["Select Restore membership and confirm"]
    Suspend --> Inactive["Member appears under No longer active"]
    Restore --> Active["Member returns to active Members"]
```

## Code flow

```mermaid
flowchart TD
  directory["Authorized member directory supplies the row's manage flag"] --> row["MemberRow enables actions for manageable targets"]
  row -->|Active member role edit| role["MemberConfirmations opens role dialog with current role"]
  row -->|Suspend or restore| status["MemberConfirmations shows the status confirmation"]
  role -->|Cancel| close["Close without sending"]
  role -->|Save| save["Close role dialog; createRoleMutation skips unchanged role"]
  status -->|Cancel| close
  status -->|Confirm| confirmed["confirmedMemberAction dispatches MemberMutationService.changeStatus"]
  save -->|Changed| transaction["MembersController or MemberStatusController runs the scoped Access Control mutation"]
  confirmed --> transaction
  transaction -->|Denied| error["Show action refusal"]
  transaction -->|Role changed| revision["Advance planning revision and record membership audit"]
  transaction -->|Status changed| reset["Clear retained sign-in observation"]
  reset --> revision
  revision --> reload["Refresh the directory"]
  transaction -->|Unknown result| reload
```

**Code references:** [MemberRow.tsx](../../apps/frontend/src/components/team/MemberRow.tsx#L19) · [MemberConfirmations.tsx](../../apps/frontend/src/components/team/MemberConfirmations.tsx#L40) · [buildMemberDirectoryPresentation.ts](../../apps/frontend/src/components/team/buildMemberDirectoryPresentation.ts#L50) · [createMemberMutations.ts](../../apps/frontend/src/components/team/createMemberMutations.ts#L56) · [member_directory_service.ts](../../apps/backend/app/services/membership/member_directory_service.ts#L104) · [member_mutation_service.ts](../../apps/backend/app/services/membership/member_mutation_service.ts#L38) · [member_administration.spec.ts](../../apps/backend/tests/functional/membership/member_administration.spec.ts#L355)
