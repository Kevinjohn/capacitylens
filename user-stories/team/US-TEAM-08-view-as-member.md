# US-TEAM-08 — View the company as a member

As an Owner or Admin, I want to view the app as another active member so that I can understand what that member sees.

**Status:** Current
**Access:** Owner, Admin; another active member is the target
**Entry:** Team & access → Members → View the app as this member
**Documentation:** [Roles and permissions](../../docs-src/getting-started/roles-and-permissions.md)
**Source:** [MemberRow.tsx](../../apps/frontend/src/components/team/MemberRow.tsx); [MasqueradeBanner.tsx](../../apps/frontend/src/components/MasqueradeBanner.tsx)

## Acceptance criteria

- On another active member’s row, the eye button (**View the app as {member}**) opens **View as this member?**; **Start masquerade** opens the member view and **Cancel** closes the dialog.
- A banner reads **Masquerading as {name}** with **Ends {time}** and offers **End now**; a **Retry** control appears when the member view needs to be restored.
- The member view is read-only and expires after 15 minutes. Company navigation ends it; signing out ends it for the current session.
- Other signed-in sessions observe the same member view, or its end, on their next request.
