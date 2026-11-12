# US-NAV-07 — Recover from a rendering error

As a company member, I want a clear recovery action after an unexpected display failure so that I can reload the application.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Something went wrong screen → Reload

**Documentation:** [Faq](../../docs-src/using/faq.md)

**Source:** [ErrorBoundary.tsx](../../apps/frontend/src/components/common/ErrorBoundary.tsx)

## Acceptance criteria

- An uncaught rendering failure displays an error screen and Reload action instead of a blank page.

## User flow

```mermaid
flowchart TD
  human1["A rendering failure occurs"]
  human2["Recovery screen explains the failure"]
  human3["Select Reload"]
  human4["Application restarts"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
```

## Code flow

```mermaid
flowchart TD
  route["router catches route error"] --> routeError["RouteError resolves message"]
  outside["ErrorBoundary catches outer React error"] --> fallback["ErrorFallback renders message"]
  routeError --> fallback
  fallback --> reload["reloadPage reloads document"]
```

**Code references:** [router.tsx](../../apps/frontend/src/router.tsx); [ErrorBoundary.tsx](../../apps/frontend/src/components/common/ErrorBoundary.tsx); [reloadPage.ts](../../apps/frontend/src/lib/reloadPage.ts)
