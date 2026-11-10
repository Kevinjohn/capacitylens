# US-NAV-18 — Recover from an unmatched address

As a company member, I want an unmatched address to explain that the page was not found and offer a route back so that I can resume navigation.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer; sign-in wall still applies to protected routes.

**Entry:** Unmatched extensionless URL → Page not found → Schedule link.

**Documentation:** [FAQ](../../docs-src/using/faq.md)

**Source:** [router.tsx](../../apps/frontend/src/router.tsx); [NotFound.tsx](../../apps/frontend/src/components/common/NotFound.tsx)

## Acceptance criteria

- An unmatched application route renders a branded not-found page with a Schedule link. Missing assets and API routes remain HTTP errors; valid invitation and reset paths retain their route handling.

## User flow

```mermaid
flowchart TD
  human1["Open an unmatched address"]
  human2["Page not found appears"]
  human3["Select Schedule"]
  human4["Schedule opens"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
```

## Code flow

```mermaid
flowchart TD
  url["Browser requests unmatched path"] --> route["router wildcard route"]
  route --> page["NotFound renders branded message"]
  page --> link["Schedule link navigates to /"]
  root["router index route"] --> schedule["SchedulerView renders schedule"]
```

**Code references:** [router.tsx](../../apps/frontend/src/router.tsx); [NotFound.tsx](../../apps/frontend/src/components/common/NotFound.tsx); [SchedulerView.tsx](../../apps/frontend/src/components/scheduler/SchedulerView.tsx)
