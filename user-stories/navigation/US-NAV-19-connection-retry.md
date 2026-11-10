# US-NAV-19 — Retry after a server connection failure

As a company member, I want to retry when the application cannot connect to the server so that I can resume after service returns.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Connection failure screen → Retry

**Documentation:** [When something goes wrong](../../docs-src/self-hosting/incidents.md)

**Source:** [ConnectionError.tsx](../../apps/frontend/src/components/ConnectionError.tsx); [AppEntryGate.tsx](../../apps/frontend/src/components/AppEntryGate.tsx)

## Acceptance criteria

- A connection failure shows a Retry action that reloads the application and retries its server connection; no local reset action is offered.
