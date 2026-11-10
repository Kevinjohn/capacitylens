# US-SET-03 — Read build details

As an Owner or Admin, I want to read the build details so that I can identify which version I am using.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Diagnostics → Build details (when configured)
**Documentation:** [Diagnostics](../../docs-src/admin/diagnostics.md)
**Source:** [DiagnosticsBuildDetails.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsBuildDetails.tsx)

## Acceptance criteria

- With a configured build SHA, Diagnostics shows the SHA and server/demo mode as plain text. Without a SHA, the row is absent.
