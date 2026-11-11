# US-NAV-20 — Recover when the active company fails to load

As a company member, I want to retry loading the active company so that I can continue if its planning data becomes available.

**Status:** Hidden — retained screen with no current error-state producer.

**Access:** Owner, Admin, Editor, Viewer; Choose another is available only in demo mode.

**Entry:** No current entry; retained company-load recovery screen.

**Documentation:** [When something goes wrong](../../docs-src/self-hosting/incidents.md)

**Source:** [AccountLoadRecovery.tsx](../../apps/frontend/src/components/accounts/AccountLoadRecovery.tsx); [AppEntryGate.tsx](../../apps/frontend/src/components/AppEntryGate.tsx); [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx)

## Acceptance criteria

- Retry attempts to refresh the failed active company's planning data and reports a failed retry. In demo mode only, Choose another returns to the company picker; persisted installations do not offer that action.
