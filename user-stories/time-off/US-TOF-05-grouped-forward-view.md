# US-TOF-05 — Scan current and future time off by resource

As a company member, I want current and future time off grouped by resource so that upcoming time off is easy to review.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Time off page

**Documentation:** [time-off.md](../../docs-src/using/time-off.md)

**Source:** [TimeOffForm.tsx](../../apps/frontend/src/components/time-off/TimeOffForm.tsx)

## Acceptance criteria

- The Time off page groups entries by resource under **Personal time off**.
- Entries that ended before the start of the current week are hidden without being deleted; entries for placeholders are hidden while Show placeholders is off.

## User flow

```mermaid
flowchart TD
  N1["Open Time off page"]
  N2["entries are grouped by resource and show current/future time off"]
  N3["past entries are omitted from this view but retained"]
  N1 --> N2
  N2 --> N3
```

## Code flow

```mermaid
flowchart TD
  Entry["/timeoff → CompanyDateRoute waits for company date"] --> Data["TimeOffList reads useActiveScopedData"]
  Data --> Groups["buildTimeOffGroups uses configured company week start"]
  Groups -->|ends before week or placeholder hidden| Omit["Omit row from view"]
  Groups -->|missing resource in input| Unknown["Collect in final fallback group"]
  Groups -->|eligible resource| Sort["Sort group by resource display name, rows by dates and ID"]
  Groups -->|no groups after filtering| Empty["PersonalTimeOffSection shows No time off booked"]
  Sort --> Show["Render groups; write actions use current permissions"]
  Unknown --> Show
```

**Code references:**

- [router.tsx](../../apps/frontend/src/router.tsx#L191)
- [TimeOffList.tsx](../../apps/frontend/src/components/time-off/TimeOffList.tsx#L34)
- [TimeOffList.tsx](../../apps/frontend/src/components/time-off/TimeOffList.tsx#L129)
- [timeOffView.ts](../../apps/frontend/src/components/time-off/timeOffView.ts#L41)
- [projection.ts](../../packages/shared/src/domain/lifecycle/projection.ts#L36)
- [TimeOffList.test.tsx](../../apps/frontend/src/components/time-off/TimeOffList.test.tsx#L217)
- [TimeOffList.test.tsx](../../apps/frontend/src/components/time-off/TimeOffList.test.tsx#L379)
