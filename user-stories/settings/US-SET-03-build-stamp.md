# US-SET-03 — Read build details

As an Owner or Admin, I want to read the build details so that I can identify which version I am using.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Help → Diagnostics (Owner, Admin) or the command palette → Diagnostics, then Build details (when configured)
**Documentation:** [Diagnostics](../../docs-src/admin/diagnostics.md)
**Source:** [DiagnosticsBuildDetails.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsBuildDetails.tsx)

## Acceptance criteria

- With a configured build SHA, Build details shows `build {SHA} · server` as plain text. Without a SHA the stamp is absent, and Build details is omitted when there is also no feedback address.

## User flow

```mermaid
flowchart TD
A["Open Help and select Diagnostics, or choose Diagnostics in the command palette"] --> B{"Build details available?"}
B -->|yes| C["Read the build identifier and mode"]
B -->|no| D["Build details row is omitted"]
```

## Code flow

```mermaid
flowchart TD
  entry["HelpView Diagnostics link or palette Diagnostics item opens /diagnostics"] --> view["DiagnosticsBuildDetails renders"] --> info["buildInfo.readBuildStamp reads configured build SHA"]
  info --> stamp["buildInfo formats build stamp and mode"]
  stamp --> row["DiagnosticsBuildDetails shows or omits row"]
```

**Code references:** [HelpView.tsx](../../apps/frontend/src/components/HelpView.tsx), [DiagnosticsBuildDetails.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsBuildDetails.tsx), [buildInfo.ts](../../apps/frontend/src/data/buildInfo.ts)
