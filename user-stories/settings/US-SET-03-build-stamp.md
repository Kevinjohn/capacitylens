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
  route["DiagnosticsRoute checks access before rendering DiagnosticsView"] --> view["DiagnosticsBuildDetails reads build stamp and feedback URL"]
  view --> checks{"At least one usable value?"}
  checks -->|neither| omitted["Omit the section"]
  checks -->|yes| section["Render DiagnosticsBuildDetails section"]
  section -->|valid trimmed 7 to 64 digit hexadecimal SHA| display["Render the preformatted build SHA · server stamp"]
  section -->|valid feedback href| feedback["Render feedback link independently of stamp"]
```

**Code references:** [router.tsx:145](../../apps/frontend/src/router.tsx#L145) · [DiagnosticsBuildDetails.tsx:6](../../apps/frontend/src/components/diagnostics/DiagnosticsBuildDetails.tsx#L6) · [buildInfo.ts:64](../../apps/frontend/src/data/buildInfo.ts#L64) · [buildInfo.ts:208](../../apps/frontend/src/data/buildInfo.ts#L208)
