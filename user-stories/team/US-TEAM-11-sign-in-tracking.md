# US-TEAM-11 — Record member sign-ins

As an Owner, I want to enable member sign-in recording so that I can see whether each member has signed in.

**Status:** Hidden — server capability retained; no current product control.
**Access:** Owner; the control is not currently rendered
**Entry:** Team & access → Members (control hidden)
**Documentation:** [Invite teammates](../../docs-src/admin/invite-teammates.md)
**Source:** [MembersSection.tsx](../../apps/frontend/src/components/team/MembersSection.tsx)

## Acceptance criteria

The following retained control is unavailable in the current interface.

| Field                  | Control | Required/default/conditions                 |
| ---------------------- | ------- | ------------------------------------------- |
| Record member sign-ins | Switch  | Owner-only control; not currently rendered. |

- The related **Signed in** column is also hidden.

## User flow

Intended owner flow (unavailable in the current interface):

```mermaid
flowchart TD
    Owner["Intended, unavailable: Owner opens Team & access → Members"] --> Toggle["Intended, unavailable: turn on Record member sign-ins"]
    Toggle --> Review["Intended, unavailable: review Signed in status in member list"]
```

## Code flow

```mermaid
flowchart TD
  screen["MembersSection renders member controls and directory"] --> hidden["The current browser renders neither a tracking toggle nor a Signed in column"]
  api["Separate retained PUT member_sign_in_tracking endpoint"] --> auth["MemberSignInTrackingController checks members:signInTracking"]
  auth -->|Denied| refusal["Refuse request"]
  auth -->|Allowed| tracking["changeMemberSignInTracking stores setting and audits changed value as company"]
  tracking -->|Newly enabled| window["Begin observation window and confirm the enabling Owner"]
  tracking -->|Disabled| remove["Erase retained observations"]
  login["Successful password sign-in calls recordMemberSignIn"] --> producer["Record an observation for active memberships where tracking is enabled"]
  status["Changed member status"] --> erase["resetMemberSignIn clears that member's observation"]
  window --> directory["readMemberDirectory can return Boolean or null for confirmation"]
  remove --> directory
  producer --> directory
  erase --> directory
```

**Code references:** [MembersSection.tsx](../../apps/frontend/src/components/team/MembersSection.tsx#L143) · [MembersSection.tsx](../../apps/frontend/src/components/team/MembersSection.tsx#L260) · [member_sign_in_tracking_controller.ts](../../apps/backend/app/controllers/member_sign_in_tracking_controller.ts#L10) · [sign_in_tracking.ts](../../apps/backend/app/services/membership/sign_in_tracking.ts#L14) · [sign_in_tracking.ts](../../apps/backend/app/services/membership/sign_in_tracking.ts#L75) · [password_sign_in.ts](../../apps/backend/app/services/auth/password_sign_in.ts#L62) · [member_directory.ts](../../apps/backend/app/services/membership/member_directory.ts#L89) · [member_mutations.ts](../../apps/backend/app/services/membership/member_mutations.ts#L70) · [tracking_lifecycle.spec.ts](../../apps/backend/tests/functional/membership/tracking_lifecycle.spec.ts#L36)
