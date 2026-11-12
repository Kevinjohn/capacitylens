# US-SET-03 — Read build details

As an Owner or Admin, I want to read the build details so that I can identify which version I am using.

**Status:** Current
**Access:** Owner, Admin; anyone in demo mode
**Entry:** Diagnostics → Build details (when configured)
**Documentation:** [Diagnostics](../../docs-src/admin/diagnostics.md)
**Source:** [DiagnosticsBuildDetails.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsBuildDetails.tsx)

## Acceptance criteria

- With a configured build SHA, Build details shows `build {SHA} · server` or `build {SHA} · demo` as plain text. Without a SHA the stamp is absent, and Build details is omitted when there is also no feedback address.

## User flow

```mermaid
flowchart TD
A["Open Diagnostics"] --> B{"Build details available?"}
B -->|yes| C["Read the build identifier and mode"]
B -->|no| D["Build details row is omitted"]
```

## Code flow

```mermaid
flowchart TD
  view["DiagnosticsBuildDetails renders"] --> info["buildInfo.readBuildStamp reads configured build SHA"]
  info --> stamp["buildInfo formats build stamp and mode"]
  stamp --> row["DiagnosticsBuildDetails shows or omits row"]
```

**Code references:** [DiagnosticsBuildDetails.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsBuildDetails.tsx), [buildInfo.ts](../../apps/frontend/src/data/buildInfo.ts)
