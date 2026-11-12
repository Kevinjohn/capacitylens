# US-SET-16 — Copy diagnostics

As an Owner or Admin, I want to copy diagnostics so that I can share useful troubleshooting details.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Diagnostics → Copy diagnostics
**Documentation:** [Diagnostics](../../docs-src/admin/diagnostics.md)
**Source:** [DiagnosticsView.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsView.tsx)

## Acceptance criteria

- **Copy diagnostics** copies the displayed support report and shows confirmation or a clipboard error.

## User flow

```mermaid
flowchart TD
A["Open Diagnostics"] --> B["Select Copy diagnostics"]
B --> C{"Clipboard copy succeeds?"}
C -->|yes| D["Paste the support report where needed"]
C -->|no| E["Read the clipboard error and retry when available"]
```

## Code flow

```mermaid
flowchart TD
  view["DiagnosticsView renders report and Copy report button"] --> controller["useDiagnosticsController.copyReport"]
  controller --> clipboard["navigator.clipboard.writeText(report)"]
  clipboard --> state{"Clipboard result"}
  state -->|"success"| copied["copyState becomes copied"]
  state -->|"failure"| failed["copyState becomes failed"]
```

**Code references:** [DiagnosticsView.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsView.tsx), [useDiagnosticsController.ts](../../apps/frontend/src/components/diagnostics/useDiagnosticsController.ts), [buildInfo.ts](../../apps/frontend/src/data/buildInfo.ts)
