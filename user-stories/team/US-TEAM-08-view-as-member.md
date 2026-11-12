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

## User flow

```mermaid
flowchart TD
    Row["Open an active member's row"] --> Confirm["Select View the app as {member}, then Start masquerade"]
    Confirm --> View["Read-only app opens with member banner and expiry"]
    View --> End["Select End now"]
    End --> Own["Return to your own company view"]
    View --> Retry["If the member view needs restoring, select Retry"]
    View --> Switch["Switch company; the member view ends"]
```

## Code flow

```mermaid
flowchart TD
    Row["MemberRow offers view action to eligible Owner or Admin"] --> Confirm["MemberConfirmations confirmMemberAction"]
    Confirm --> Start["useMembersOrchestration calls accountTransition.startMasquerade"]
    Start --> Controller["masqueradeController.start → masqueradeApi.start"]
    Controller --> Request["accountClient POST api.masquerade.start"]
    Request --> Server["MasqueradeController.start → auth masquerade service → Masquerade package start"]
    Server --> Projection["Controller returns currentMasquerade; controller loads target projection into store"]
    Projection --> Banner["AppShell renders MasqueradeBanner; permissionContext hides write affordances"]
    Banner --> ReadOnly["MasqueradeReadOnlyMiddleware refuses product writes while mode is active"]
    Banner --> End["End now → accountTransition.endMasquerade → package stop and real projection restore"]
```

**Code references:** [MemberRow.tsx](../../apps/frontend/src/components/team/MemberRow.tsx), [MemberConfirmations.tsx](../../apps/frontend/src/components/team/MemberConfirmations.tsx), [useMembersOrchestration.ts](../../apps/frontend/src/components/team/useMembersOrchestration.ts), [accountTransition.ts](../../apps/frontend/src/auth/accountTransition.ts), [masqueradeController.ts](../../apps/frontend/src/auth/masqueradeController.ts), [masqueradeApi.ts](../../apps/frontend/src/auth/masqueradeApi.ts), [accountClient.ts](../../apps/frontend/src/account/accountClient.ts), [masquerade_routes.ts](../../apps/backend/start/masquerade_routes.ts), [masquerade_controller.ts](../../apps/backend/app/controllers/masquerade_controller.ts), [masquerade.ts](../../apps/backend/app/services/auth/masquerade.ts), [masquerade_read_only_middleware.ts](../../apps/backend/app/middleware/masquerade_read_only_middleware.ts), [permissionContext.ts](../../apps/frontend/src/auth/permissionContext.ts), [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx)
