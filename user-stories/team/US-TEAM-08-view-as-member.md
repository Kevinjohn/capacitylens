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
```

## Code flow

```mermaid
flowchart TD
  row["MemberRow offers View the app as this member to an eligible manager"] --> dialog["MemberConfirmations asks View as member or Cancel"]
  dialog -->|Cancel| close["Close without starting"]
  dialog -->|Confirm| flush["masqueradeModel flushes pending saves and claims the transition"]
  flush -->|Cannot start| refused["Show start error"]
  flush -->|Ready| start["MasqueradeController.store passes the HTTP context and expected token to startMasquerade"]
  start --> policy["Package checks current Account Kit credentials and masqueradePolicy for company and rank"]
  policy -->|Refused| refused
  policy -->|View-only context returned| load["Load target grant and canonical read-only projection"]
  load -->|Failed| recovery["Keep unsafe projection closed; offer Retry"]
  recovery --> load
  load -->|Ready| banner["AppShell shows MasqueradeBanner"]
  banner --> request["Member routes use web_effective; Masquerade admits the request and checks current context"]
  request -->|Write, restricted read or invalid context| denied["Server refuses"]
  request -->|Planning read admitted| scope["resolveEffectiveReadUser rechecks both roles in the actor transaction"]
  scope -->|Ineligible| denied
  scope -->|Eligible| access["resolvePlanningAccess checks the effective member’s planning:read permission"]
  access -->|Refused| denied
  access -->|Allowed| view["Serve target's read projection"]
  banner -->|End now| stop["MasqueradeController.destroy validates matching context and passes the request to endMasquerade"]
  transition["Retained company transition handler"] -->|company_switch| stop
  stop -->|Stopped| real["Reload real or destination projection"]
  stop -->|Failed| endError["Show close failure and retain recovery"]
  banner -->|Expiry detected| refresh["MasqueradeController.show checks the session and view-as status; client restores the real projection"]
```

The current one-company interface offers no company switcher. See [signed-in requests](../REFERENCE.md#signed-in-requests) for how an admitted view-as context reaches the actor transaction.

**Code references:** [MemberRow.tsx](../../apps/frontend/src/components/team/MemberRow.tsx#L98) · [MasqueradeBanner.tsx](../../apps/frontend/src/components/MasqueradeBanner.tsx#L24) · [masqueradeModel.ts](../../apps/frontend/src/auth/masqueradeModel.ts#L190) · [masqueradeModel.ts](../../apps/frontend/src/auth/masqueradeModel.ts#L311) · [masquerade_controller.ts](../../apps/backend/app/controllers/masquerade_controller.ts#L26) · [masquerade_controller.ts](../../apps/backend/app/controllers/masquerade_controller.ts#L75) · [masquerade.ts](../../apps/backend/app/validators/masquerade.ts#L12) · [package_callbacks_provider.ts](../../apps/backend/providers/package_callbacks_provider.ts#L56) · [masquerade_authority.ts](../../apps/backend/app/services/auth/masquerade_authority.ts#L14) · [route_middleware.ts](../../apps/backend/start/route_middleware.ts#L17) · [masquerade.ts](../../apps/backend/app/services/auth/masquerade.ts#L125) · [access.ts](../../apps/backend/app/services/planning/access.ts#L16) · [masquerade.spec.ts](../../apps/backend/tests/functional/auth/masquerade.spec.ts#L278)
