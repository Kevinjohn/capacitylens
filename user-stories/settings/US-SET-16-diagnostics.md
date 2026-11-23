# US-SET-16 — Copy diagnostics

As an Owner or Admin, I want to copy diagnostics so that I can share useful troubleshooting details.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Help → Diagnostics (Owner, Admin) or the command palette → Diagnostics, then Copy diagnostics
**Documentation:** [Diagnostics](../../docs-src/admin/diagnostics.md)
**Source:** [DiagnosticsView.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsView.tsx)

## Acceptance criteria

- Diagnostics is not in the left menu. Owners and Admins open it from the **Diagnostics** link on Help or from the command palette; Editors and Viewers see neither, and `/diagnostics` redirects them to the schedule.
- **Copy diagnostics** copies the displayed support report and shows confirmation or a clipboard error.

## User flow

```mermaid
flowchart TD
A["Open Help and select Diagnostics, or choose Diagnostics in the command palette"] --> A2["Diagnostics opens"]
A2 --> B["Select Copy diagnostics"]
B --> C{"Clipboard copy succeeds?"}
C -->|yes| D["Paste the support report where needed"]
C -->|no| E["Read the clipboard error and retry when available"]
```

## Code flow

```mermaid
flowchart TD
  visibility["Shared route access exposes Diagnostics in Help and buildPageItems palette"] --> route["DiagnosticsRoute checks useDiagnosticsAccessDecision"]
  route -->|Pending| loading["Show loading"]
  route -->|Denied| redirect["Replace route with the root"]
  route -->|Allowed| page["DiagnosticsView calls useDiagnosticsViewModel"]
  page --> request["Send authenticated diagnostics read"]
  request --> gate["Diagnostics routes require account admission and asMemberOnly blocks view-as reads"]
  gate -->|Allowed| authorize["DiagnosticsController checks live Owner or Admin via withActor(auth)"]
  gate -->|Refused| fallback
  authorize -->|Allowed| response["Read permitted server facts"]
  authorize -->|Refused| fallback["Report server observations unavailable"]
  request -->|Unreachable| fallback
  response -->|Read succeeds| format["readDiagnostics and formatDiagnostics build the allowlisted report"]
  response -->|Database read fails| partial["Use 503 report with reachable server and unavailable database"]
  partial --> format
  fallback --> format
  format --> copy["Copy diagnostics calls navigator.clipboard.writeText"]
  copy -->|Success| copied["Show copied status"]
  copy -->|Unavailable or failed| retry["Show copy failure and retain the control"]
```

**Code references:** [HelpView.tsx](../../apps/frontend/src/components/HelpView.tsx#L50) · [navLinks.ts](../../apps/frontend/src/lib/navLinks.ts#L158) · [buildPaletteItems.ts](../../apps/frontend/src/components/buildPaletteItems.ts#L88) · [router.tsx](../../apps/frontend/src/router.tsx#L144) · [DiagnosticsView.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsView.tsx#L9) · [useDiagnosticsViewModel.ts](../../apps/frontend/src/components/diagnostics/useDiagnosticsViewModel.ts#L15) · [diagnostics_routes.ts](../../apps/backend/start/diagnostics_routes.ts#L7) · [diagnostics_controller.ts](../../apps/backend/app/controllers/diagnostics_controller.ts#L8) · [serverDiagnostics.ts](../../apps/frontend/src/data/serverDiagnostics.ts#L17) · [buildInfo.ts](../../apps/frontend/src/data/buildInfo.ts#L160)
