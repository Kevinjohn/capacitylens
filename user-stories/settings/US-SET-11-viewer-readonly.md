# US-SET-11 — View role permissions

As a company member, I want to review my role permissions so that I know what I can do in this company.

**Status:** Current — detailed access actions live in Team & access.
**Access:** Owner, Admin, Editor, Viewer
**Entry:** Team & access → Your access
**Documentation:** [Team & access](../../docs-src/using/team-access.md)
**Source:** [TeamAccessView.tsx](../../apps/frontend/src/components/team/TeamAccessView.tsx)

## Acceptance criteria

- Every member can review their role and permission summary. Server authorisation independently controls access.

## User flow

```mermaid
flowchart TD
A["Open Team & access"] --> B["Read Your access and current role"]
B --> C["Expand or collapse See all permissions"]
```

## Code flow

```mermaid
flowchart TD
  route["Team & access renders TeamAccessView"] --> grant["Read resolved effective access grant, role and visibility flags"]
  grant -->|Waiting| pending["Defer permission and management controls"]
  grant -->|Resolved| card["CurrentAccessCard renders effective role and summary"]
  card -->|View as member| projected["Use target role and read-only summary; management is unavailable"]
  card -->|See all permissions| list["PermissionList uses listPermissions on the issued grant"]
  list -->|Hide all permissions| card
```

**Code references:** [TeamAccessView.tsx](../../apps/frontend/src/components/team/TeamAccessView.tsx#L42) · [TeamAccessView.tsx](../../apps/frontend/src/components/team/TeamAccessView.tsx#L81) · [TeamAccessView.tsx](../../apps/frontend/src/components/team/TeamAccessView.tsx#L154) · [masquerade_control_service.ts](../../apps/backend/app/services/auth/masquerade_control_service.ts#L108)
