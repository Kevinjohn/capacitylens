# US-SET-16 — Copy privacy-safe diagnostics

**Area:** Settings · **Persona:** An Owner or Admin reporting a problem · **Coverage:**
`src/data/buildInfo.test.ts` + `src/components/diagnostics/DiagnosticsView.test.tsx` +
`src/router.test.tsx` + `src/components/CommandPalette.test.tsx` + `e2e/a11y.spec.ts` +
`server/src/app.health.test.ts`

**Documentation:** [Diagnostics](../../docs-src/admin/diagnostics.md)

## Goal

Copy enough build, server and browser context for support to identify a problem without copying
company data or credentials.

## Why

Support needs a reliable description of the running build, the server state and the reporter's
browser when someone reports a problem. A fixed, privacy-safe report makes that context useful
without exposing company data, credentials, identifiers or implementation details.

## How (end-to-end)

**Precondition:** Sign in to a server-mode company as an Owner or Admin. For a demo-mode check,
open the app in a build with `VITE_CAPACITYLENS_DEMO=1`.

1. Click **Diagnostics** below **Settings** in the sidebar (or choose it in the command palette).
   The URL is `/diagnostics`.
2. Review the **Support report**: the **Snapshot observed** ISO timestamp, the app version, build
   revision, deployment mode and export schema; the server connectivity, database, persistence and
   backup values that are available; the sign-in mode; this browser session's save counters; and
   the browser's user agent, viewport, time zone and language.
3. Click **Copy diagnostics**. A generic success message confirms that the report was copied.
4. Paste the report into a private support note and confirm it contains no company data,
   credentials, private paths, hostnames, personal information or raw error text.

## Acceptance criteria

- Owners and Admins see **Diagnostics** after **Settings** in the sidebar and in the command
  palette. With sign-in off (including the demo), everyone sees it.
- Editors and Viewers see no Diagnostics link, and a direct visit to `/diagnostics` redirects them
  to the schedule. While their role is still resolving, the page shows a loading status.
- The page shows the report text exactly as **Copy diagnostics** copies it.
- The server values are a point-in-time snapshot: the client records **Snapshot observed** when the
  server response arrives, or when its failure is observed. Copying does not request it again.
  The save counters are this browser session's running totals.
- Unknown, offline, shallow-health, deep-health, missing-backup and error cases stay explicitly
  labelled and never fall back to a browser schema constant as the server schema. Demo mode keeps
  client facts and marks server values unavailable.
- Secret-like unknown fields, malformed types, raw errors, private paths/hostnames, names, email
  addresses and identifiers are ignored. A browser value outside its expected shape is reported
  as **Unknown**.
- A successful copy and a clipboard failure each produce generic user-visible feedback.
- The page has no serious or critical axe violations.
- Settings has no Diagnostics row; its **Build details** stamp remains for every role.
