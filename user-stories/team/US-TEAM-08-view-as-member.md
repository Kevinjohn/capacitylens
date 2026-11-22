# US-TEAM-08 — View the company as a member

As an Owner or Admin, I want to view the app as another active member ranked at or below me so that I can understand what that member sees.

**Status:** Current
**Access:** Owner, Admin; another active member ranked at or below you is the target
**Entry:** Team & access → Members → View the app as this member
**Documentation:** [Roles and permissions](../../docs-src/getting-started/roles-and-permissions.md)
**Source:** [MemberRow.tsx](../../apps/frontend/src/components/team/MemberRow.tsx); [MasqueradeBanner.tsx](../../apps/frontend/src/components/MasqueradeBanner.tsx)

## Acceptance criteria

- On the row of another active member ranked at or below you, the eye button (**View the app as {member}**) opens **View as this member?**; **View as member** starts the view as that member and **Cancel** closes the dialog.
- A banner reads **Viewing as {name}** with **Ends {time}** and offers **End now**; a **Retry** control appears when the view as that member needs to be restored.
- The view as a member is read-only and expires after 15 minutes. Company navigation ends it; signing out ends it for the current session.
- Other signed-in sessions observe the same view as that member, or its end, on their next request.

## User flow

```mermaid
flowchart TD
    Row["Open an active member's row"] --> Confirm["Select View the app as {member}, then View as member"]
    Confirm --> View["Read-only app opens with member banner and expiry"]
    View --> End["Select End now"]
    End --> Own["Return to your own company view"]
    View --> Retry["If the view as that member needs restoring, select Retry"]
    View --> Switch["Switch company; the view as that member ends"]
```

## Code flow

```mermaid
flowchart TD
    Row["MemberRow offers view action to eligible Owner or Admin"] --> Confirm["MemberConfirmations confirmMemberAction"]
    Confirm --> Start["useMembersOrchestration calls companyTransition.startMasquerade"]
    Start --> Model["masqueradeModel.start → masqueradeApi.start"]
    Model --> Request["masqueradeRequests POST api.masquerade.store"]
    Request --> Server["MasqueradeController.store → auth masquerade service → Masquerade package start"]
    Server --> Projection["Controller returns readCurrentMasquerade; model loads target projection into store"]
    Projection --> Banner["AppShell renders MasqueradeBanner; permissionContext hides write affordances"]
    Banner --> ReadOnly["Masquerade context middleware refuses product writes while mode is active"]
    Banner --> End["End now → companyTransition.endMasquerade → package stop and real projection restore"]
```

**Code references:** [MemberRow.tsx](../../apps/frontend/src/components/team/MemberRow.tsx), [MemberConfirmations.tsx](../../apps/frontend/src/components/team/MemberConfirmations.tsx), [useMembersOrchestration.ts](../../apps/frontend/src/components/team/useMembersOrchestration.ts), [companyTransition.ts](../../apps/frontend/src/auth/companyTransition.ts), [masqueradeModel.ts](../../apps/frontend/src/auth/masqueradeModel.ts), [masqueradeApi.ts](../../apps/frontend/src/auth/masqueradeApi.ts), [masqueradeRequests.ts](../../apps/frontend/src/auth/masqueradeRequests.ts), [masquerade_routes.ts](../../apps/backend/start/masquerade_routes.ts), [masquerade_controller.ts](../../apps/backend/app/controllers/masquerade_controller.ts), [masquerade.ts](../../apps/backend/app/services/auth/masquerade.ts), [masquerade_context_middleware.ts](../../apps/backend/app/middleware/masquerade_context_middleware.ts), [route_middleware.ts](../../apps/backend/start/route_middleware.ts), [permissionContext.ts](../../apps/frontend/src/auth/permissionContext.ts), [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx)
