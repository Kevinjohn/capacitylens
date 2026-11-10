# US-SET-04 — Open a feedback email

As an Owner or Admin, I want to open a preaddressed feedback email so that I can report a problem with its build context.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Diagnostics → Send feedback (when configured)
**Documentation:** [Diagnostics](../../docs-src/admin/diagnostics.md)
**Source:** [DiagnosticsBuildDetails.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsBuildDetails.tsx)

## Acceptance criteria

- With a configured valid feedback address, Send feedback opens a mail draft with the address and available build context. Without a configured address, the action is absent.
