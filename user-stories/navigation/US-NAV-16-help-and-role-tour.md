# US-NAV-16 — Find help and start the role-based tour

**Area:** Navigation & shell · **Persona:** Any company member · **Linked coverage:** `e2e/navigation.spec.ts`, `e2e/mobile.spec.ts`, `e2e/help.auth.spec.ts`, `src/components/AppShell.test.tsx`, `src/components/CommandPalette.test.tsx`, `src/components/HelpView.test.tsx`

**Documentation:** [Use CapacityLens day to day](../../docs-src/using/index.md), [Take a role-based tour](../../docs-src/getting-started/roles-and-permissions.md#take-a-role-based-tour)

## Goal

Open help and learn the schedule controls that match your role, even after first-run guidance is dismissed.

## Why

Viewers need a way to understand the read-only schedule. The same tour remains useful to every role after setup is complete.

## How

1. Open **Help** in the sidebar footer, immediately above **Account**, or find it in the command palette.
2. Read the short description and follow **Browse the user guides** for detailed instructions.
3. Select **Show tour**. The tour starts on Schedule and follows the current role's section and any lower-role guidance.
4. As a Viewer, use the two read-only stops to learn the schedule and its toolbar.

## Acceptance criteria

- Help (`/help`) is available to Owner, Admin, Editor and Viewer, above Account in the expanded, collapsed and mobile sidebar.
- Direct navigation sets the page title to **Help · CapacityLens**. The command palette lists Help exactly once and navigates to `/help`.
- The page links to the existing user guides and provides a **Show tour** launcher.
- The launcher uses the shared permission, offline, duplicate-start and failure behavior. Starting away from Schedule opens Schedule first; a Viewer sees progress 1 of 2.
- Help and its tour remain available when Getting started is hidden or dismissed.
