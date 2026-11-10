# US-TEAM-08 — View the company as a member

As an Owner or Admin, I want to view the app as another active member so that I can understand what that member sees.

**Status:** Current
**Access:** Owner, Admin; another active member is the target
**Entry:** Team & access → Members → View the app as this member
**Documentation:** [Roles and permissions](../../docs-src/getting-started/roles-and-permissions.md)
**Source:** [MemberRow.tsx](../../apps/frontend/src/components/team/MemberRow.tsx); [MasqueradeBanner.tsx](../../apps/frontend/src/components/MasqueradeBanner.tsx)

## Acceptance criteria

- **View the app as this member** asks for confirmation before opening the member view.
- A banner identifies the member, shows when the view ends, and offers **End now**; a **Retry** control appears when the member view needs to be restored.
- The member view is read-only and expires after 15 minutes. Company navigation ends it; signing out ends it for the current session.
- Other signed-in sessions observe the same member view, or its end, on their next request.
