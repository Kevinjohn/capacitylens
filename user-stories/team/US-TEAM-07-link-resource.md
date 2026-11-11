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
- A retained link to an archived or deleted person is shown as **{name} (inactive — unlink only)** and can only be removed. Linking a member does not change their access or create schedule data.
