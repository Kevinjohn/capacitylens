# US-SET-16 — Copy privacy-safe diagnostics

**Area:** Settings · **Persona:** A person reporting a server problem · **Coverage:**
`src/data/buildInfo.test.ts` + `src/components/settings/SettingsView.test.tsx` +
`server/src/app.health.test.ts`

## Goal

Copy enough build and health context for support to identify a problem without copying company
data or credentials.

## Why

Support needs a reliable description of the running build and server state when a person reports
a problem. A fixed, privacy-safe projection makes that context useful without exposing company data,
credentials, identifiers or implementation details.

## How (end-to-end)

**Precondition:** Sign in to a server-mode company and open **Settings**. For a demo-mode check,
open Settings in a build with `VITE_CAPACITYLENS_DEMO=1`.

1. Scroll to the **Diagnostics** card at the bottom of Settings.
2. Review the app version, build revision, deployment mode and export schema, followed by the
   server connectivity, database, persistence and backup values that are available.
3. Click **Copy diagnostics**. A generic success message confirms that the report was copied.
4. Paste the report into a private support note and confirm it contains no company data,
   credentials, private paths, hostnames, personal information or raw error text.

## Acceptance criteria

- Settings shows a Diagnostics card at the bottom in server and demo modes with a `Copy diagnostics` action.
- The projection includes only app version, validated build revision when available, deployment mode,
  export schema, server connectivity, database schema, persistence status and backup status/last
  success where observable.
- Unknown, offline, shallow-health, deep-health, missing-backup and error cases stay explicitly
  labelled and never fall back to a browser schema constant as the server schema. Demo mode keeps
  client facts and marks server values unavailable.
- Secret-like unknown fields, malformed types, raw errors, private paths/hostnames, PII and
  identifiers are ignored.
- A successful copy and a clipboard failure each produce generic user-visible feedback.
