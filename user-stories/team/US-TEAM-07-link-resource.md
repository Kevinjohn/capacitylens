# US-TEAM-07 — Link a member to a Resource

As an Owner or Admin, I want to link a member to a person Resource so that their sign-in is connected to the right schedule row.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Team & access → Members → Link to Resource
**Documentation:** [Link a person to a member](../../docs-src/using/resources.md#link-a-person-to-a-member)
**Source:** [MemberResourceLink.tsx](../../apps/frontend/src/components/team/MemberResourceLink.tsx)

## Acceptance criteria

| Field            | Control | Required/default/conditions                                                                       |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------- |
| Scheduled person | Select  | Optional; shows the current link or None. Choices are active people not linked to another member. |

- Selecting a person links or changes the link immediately. **Remove link to resource** unlinks immediately.
- A retained link to an inactive person is shown and can be removed. Linking a member does not change their access or create schedule data.

## User flow

```mermaid
flowchart TD
    Open["Owner or Admin opens a member's Link to Resource dialog"] --> Choose{"Choose a person or None"}
    Choose -->|"Choose a person"| Link["Member is linked or changed to that person"]
    Choose -->|"Choose None for a linked member"| Unlink["Member's Resource link is removed"]
    Link --> Refresh["Member row refreshes with the current link"]
    Unlink --> Refresh
```

## Code flow

```mermaid
flowchart TD
    Dialog["MemberResourceDialog renders eligible choices"] --> Select["MemberResourceEditor change calls useMemberResourceLinkRequest"]
    Select --> Choose{"Person selected?"}
    Choose -->|"Yes"| SetClient["teamAccessClient.setMemberResourceLink → accountClient PUT resource-link"]
    SetClient --> SetRoute["api.member-resources.set → MemberResourcesController.setLink"]
    SetRoute --> SetLink["setMemberResourceLink updates account_member_resources"]
    Choose -->|"None"| ClearClient["teamAccessClient.clearMemberResourceLink → accountClient DELETE resource-link"]
    ClearClient --> ClearRoute["api.member-resources.clear → MemberResourcesController.clearLink"]
    ClearRoute --> ClearLink["clearMemberResourceLink removes account_member_resources row"]
    SetLink --> Reload["Request hook invalidates avatars and reloads directory"]
    ClearLink --> Reload
    Reload --> Row["Member row shows refreshed link or a visible error"]
```

**Code references:** [MemberResourceLink.tsx](../../apps/frontend/src/components/team/MemberResourceLink.tsx), [useMemberResourceLinkRequest.ts](../../apps/frontend/src/components/team/useMemberResourceLinkRequest.ts), [teamAccessClient.ts](../../apps/frontend/src/account/teamAccessClient.ts), [accountClient.ts](../../apps/frontend/src/account/accountClient.ts), [admission_routes.ts](../../apps/backend/start/admission_routes.ts), [member_resources_controller.ts](../../apps/backend/app/controllers/member_resources_controller.ts), [links.ts](../../apps/backend/app/services/member_resources/links.ts)
