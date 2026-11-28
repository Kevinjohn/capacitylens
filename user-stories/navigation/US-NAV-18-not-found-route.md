# US-NAV-18 — Recover from an unmatched address

As a company member, I want an unmatched address to explain that the page was not found and offer a route back so that I can resume navigation.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer; sign-in wall still applies to protected routes.

**Entry:** Unmatched extensionless URL → Page not found → Go to schedule.

**Documentation:** [FAQ](../../docs-src/using/faq.md)

**Source:** [router.tsx](../../apps/frontend/src/router.tsx); [NotFound.tsx](../../apps/frontend/src/components/common/NotFound.tsx)

## Acceptance criteria

- An unmatched application route renders **Page not found** (“That page does not exist or may have moved.”) with a **Go to schedule** link. Missing assets and API routes remain HTTP errors; valid invitation and reset paths retain their route handling.

## User flow

```mermaid
flowchart TD
  human1["Open an unmatched address"]
  human2["Page not found appears"]
  human3["Select Go to schedule"]
  human4["Schedule opens"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
```

## Code flow

The frontend wildcard handles a navigation miss after the server and authentication gates allow the SPA route.

```mermaid
flowchart TD
  url["Unmatched browser GET reaches backend fallback"] --> type{"Request path"}
  type -->|API| api["Limited account gate precedes JSON 404 on the API fallback"]
  type -->|asset or dotted last segment| http["SPA fallback replies HTTP 404"]
  type -->|trailing slash| slash["Redirect with HTTP 301 to the address without it"]
  slash --> url
  type -->|eligible navigation| spa["Send index.html with no-store"]
  spa --> auth{"Outer AuthProvider gate"}
  auth -->|signed out and ordinary address| sign["SignInGate renders sign-in before RouterProvider"]
  auth -->|checking| loading["AuthLoading renders before RouterProvider"]
  auth -->|lookup failed| authError["AuthError offers a new auth check"]
  authError -->|retry| auth
  auth -->|limited access or company setup| limited["AuthProvider renders the applicable gate"]
  auth -->|public entry, allowed email verification or admitted| match{"router matches path"}
  match -->|known invitation, verification or reset| specifically["Matched public route renders its own entry"]
  match -->|unmatched| page["NotFound renders outside the company shell"]
  page --> link["Go to schedule navigates to /"]
  link --> root["AppShell and CompanyDateRoute gate SchedulerView"]
```

**Code references:** [routes.ts:62](../../apps/backend/start/routes.ts#L67) · [main.tsx:30](../../apps/frontend/src/main.tsx#L30) · [AuthProvider.tsx:245](../../apps/frontend/src/auth/AuthProvider.tsx#L245) · [router.tsx:172](../../apps/frontend/src/router.tsx#L172) · [router.tsx:206](../../apps/frontend/src/router.tsx#L206) · [router.tsx:238](../../apps/frontend/src/router.tsx#L238) · [NotFound.tsx:1](../../apps/frontend/src/components/common/NotFound.tsx#L1)
