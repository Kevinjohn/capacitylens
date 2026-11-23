# US-SET-04 — Open a feedback email

As an Owner or Admin, I want to open a preaddressed feedback email so that I can report a problem with its build context.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Diagnostics → Send feedback (when configured)
**Documentation:** [Diagnostics](../../docs-src/admin/diagnostics.md)
**Source:** [DiagnosticsBuildDetails.tsx](../../apps/frontend/src/components/diagnostics/DiagnosticsBuildDetails.tsx)

## Acceptance criteria

- With a configured valid feedback address, **Send feedback** opens a mail draft to that address with the subject `CapacityLens feedback`, followed by the build stamp when one is configured. Without a valid address the link is absent.

## User flow

```mermaid
flowchart TD
A["Open Diagnostics"] --> B{"Feedback address configured?"}
B -->|yes| C["Select Send feedback"] --> D["Review the draft in the email application"]
B -->|no| E["No feedback action is shown"]
```

## Code flow

```mermaid
flowchart TD
  view["DiagnosticsBuildDetails calls readFeedbackMailto"] --> valid{"Configured address passes isAccountEmail?"}
  valid -->|no| skip["Return null; no feedback link"]
  valid -->|yes| stamp{"readBuildStamp returns a stamp?"}
  stamp -->|yes| decorated["Include the build stamp after the feedback subject"]
  stamp -->|no| plain["Use the standard feedback subject"]
  decorated --> link["Percent-encode recipient parts and subject; render mailto anchor"]
  plain --> link
  link --> click["Activation hands mailto to the browser or configured handler"]
```

**Code references:** [DiagnosticsBuildDetails.tsx:19](../../apps/frontend/src/components/diagnostics/DiagnosticsBuildDetails.tsx#L19) · [buildInfo.ts:210](../../apps/frontend/src/data/buildInfo.ts#L210) · [buildInfo.ts:219](../../apps/frontend/src/data/buildInfo.ts#L219)
