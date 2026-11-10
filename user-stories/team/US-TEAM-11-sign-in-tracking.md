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
