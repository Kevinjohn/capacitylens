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
  row["MemberResourceDialog shows eligible choices and any retained link"] -->|Close| close["Dismiss dialog; a request or reread in progress continues"]
  row -->|Select active person for active member| set["Send link PUT with userId and expected link revision"]
  row -->|Remove retained link| remove["Send link DELETE with userId and expected link revision"]
  set --> tx["MemberResourceLinksController runs operation in a company transaction"]
  remove --> tx
  tx --> checks["Require company authorization and check link revision; setting also checks member and Resource eligibility"]
  checks -->|Changed| write["Write or delete the link, advance planning revision and record membership audit"]
  checks -->|No-op| retain["Keep matching link's revision"]
  checks -->|Refused or conflict| error["Preserve refusal for the editor"]
  write --> reread["Request authoritative member directory refresh"]
  retain --> reread
  error --> reread
  tx -->|Unknown result| reread
  reread -->|Successful newer directory read| unlock["Show canonical link and re-enable editing"]
  reread -->|Read failed| retry["Keep editing blocked and offer Retry"]
  retry --> reread
```

**Code references:** [MemberResourceLink.tsx](../../apps/frontend/src/components/team/MemberResourceLink.tsx#L27) · [MemberResourceLink.tsx](../../apps/frontend/src/components/team/MemberResourceLink.tsx#L89) · [useMemberResourceLinkRequest.ts](../../apps/frontend/src/components/team/useMemberResourceLinkRequest.ts#L100) · [useTeamDirectory.ts](../../apps/frontend/src/components/team/useTeamDirectory.ts#L206) · [member_resource_links_controller.ts](../../apps/backend/app/controllers/member_resource_links_controller.ts#L24) · [member_resource_link_service.ts](../../apps/backend/app/services/member_resources/member_resource_link_service.ts#L47) · [admission_resource_links.spec.ts](../../apps/backend/tests/functional/auth/admission_resource_links.spec.ts#L187)
