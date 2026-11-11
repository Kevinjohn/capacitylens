# US-TEAM-07 — Link a member to a Resource

As an Owner or Admin, I want to link a member to a person Resource so that their sign-in is connected to the right schedule row.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Team & access → Members → Link to Resource
**Documentation:** [Link a person to a member](../../docs-src/using/resources.md#link-a-person-to-a-member)
**Source:** [MemberResourceLink.tsx](../../apps/frontend/src/components/team/MemberResourceLink.tsx)

## Acceptance criteria

| Field            | Control | Required/default/conditions                                                                                                 |
| ---------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| Link to Resource | Select  | Optional; shows the current link, otherwise **No Resource linked**. Choices are active people not linked to another member. |

- Selecting a person links or changes the link immediately. **Remove link to resource** unlinks immediately.
- After a change, the selector and **Remove link to resource** stay unavailable until a member list read requested after that change has loaded, so the next change starts from the current link. Closing and reopening the dialog, collapsing the inactive members group or a failed member list read keeps them unavailable. If that read fails, the member list is replaced by its load error and **Retry**, which reloads it.
- An error or uncertain outcome stays in the dialog after closing and reopening it, until the next change. A success message is not shown again when the dialog is reopened.
- A retained link to an archived or deleted person is shown as **{name} (inactive — unlink only)** and can only be removed. Linking a member does not change their access or create schedule data.

## User flow

```mermaid
flowchart TD
    Open["Owner or Admin opens a member's Link to Resource dialog"] --> Choose{"Choose a person or No Resource linked"}
    Choose -->|"Choose a person"| Link["Member is linked or changed to that person"]
    Choose -->|"Choose No Resource linked for a linked member"| Unlink["Member's Resource link is removed"]
    Link --> Refresh["Member row refreshes with the current link"]
    Unlink --> Refresh
```

## Code flow

```mermaid
flowchart TD
    Dialog["MemberResourceDialog renders eligible choices"] --> Select["MemberResourceEditor change calls the member's request from useMemberResourceLinkRequests, owned by useMembersOrchestration"]
    Select --> Choose{"Person selected?"}
    Choose -->|"Yes"| SetClient["teamAccessClient.setMemberResourceLink → accountClient PUT resource-link"]
    SetClient --> SetRoute["api.member-resources.set → MemberResourcesController.setLink"]
    SetRoute --> SetLink["setMemberResourceLink updates account_member_resources"]
    Choose -->|"None"| ClearClient["teamAccessClient.clearMemberResourceLink → accountClient DELETE resource-link"]
    ClearClient --> ClearRoute["api.member-resources.clear → MemberResourcesController.clearLink"]
    ClearRoute --> ClearLink["clearMemberResourceLink removes account_member_resources row"]
    SetLink --> Reload["Request hook invalidates avatars and reloads directory"]
    ClearLink --> Reload
    Reload --> Fence["useTeamDirectory accepts the requested read generation only from a successful members read"]
    Fence --> Row["Member row shows refreshed link or a visible error; the editor is available again"]
```

**Code references:** [MemberResourceLink.tsx](../../apps/frontend/src/components/team/MemberResourceLink.tsx), [useMemberResourceLinkRequest.ts](../../apps/frontend/src/components/team/useMemberResourceLinkRequest.ts), [useTeamDirectory.ts](../../apps/frontend/src/components/team/useTeamDirectory.ts), [teamAccessClient.ts](../../apps/frontend/src/account/teamAccessClient.ts), [accountClient.ts](../../apps/frontend/src/account/accountClient.ts), [admission_routes.ts](../../apps/backend/start/admission_routes.ts), [member_resources_controller.ts](../../apps/backend/app/controllers/member_resources_controller.ts), [links.ts](../../apps/backend/app/services/member_resources/links.ts)
