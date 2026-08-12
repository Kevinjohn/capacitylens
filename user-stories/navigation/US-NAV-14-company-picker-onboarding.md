# US-NAV-14 — Company picker gives one clear next step (empty and populated states)

**Area:** Navigation & shell · **Persona:** New owner or invited teammate · **Linked automated coverage:** `src/components/accounts/AccountPicker.test.tsx` (empty-state copy, permission branch, visible membership roles, multi-company copy and no onboarding colour choice), `src/components/AppShell.test.tsx` (single-company reload gate boundaries), `e2e/onboarding.spec.ts` (create flow), `e2e/onboarding.db.spec.ts` (server permission/cap enforcement), `e2e/navigation.db.spec.ts` (real reload, route preservation and explicit switch)

## Goal

Choose an existing company, start a new company, or ask for an invite without the picker making
contradictory promises about what is possible.

## Why

The first screen is a decision point, not a status report. When there are no companies, the user
needs exactly the next steps available to them. When companies already exist, the copy must explain
that they can plan in one of them or create another when their role and deployment policy allow it.
Company creation should capture only decisions that matter to the calendar; the default company
colour is automatic, so onboarding does not create an unnecessary design task.

## How (end-to-end)

**Empty picker, caller may create:**

1. Start from a clean device state and complete the demo sign-in if it appears.
2. With no companies, confirm the heading is **Start planning** and the screen offers only two
   next steps: **New company** and **Ask an admin for an invite**.
3. Click **New company**. Confirm the form asks for **Company name**, week start, timezone and the
   read-only English language value; it does **not** ask the user to choose a company colour.
4. Create the company and confirm it becomes active and opens the schedule.

**Empty picker, caller cannot create:**

5. On an auth-backed empty instance, sign in as a caller without create permission. Confirm the
   invite step remains, while **New company** is absent and the copy does not promise creation.

**Populated picker:**

6. Return to a picker with at least one company. Confirm the subtitle reads
   **“Choose a company to plan, or create another one.”** only when another company may be created;
   otherwise it reads **“Choose a company to plan.”**
7. In an authenticated deploy, confirm every company shows the caller's membership role — **Owner**,
   **Admin**, **Editor** or **Viewer** — before it is opened. The demo instead says **Demo access**;
   an auth-off persisted server says **Open access**.
8. On first entry, keep the picker visible. Open the only valid company, navigate to another route,
   then reload: confirm the same route resumes without another choice. Use **Switch company** and
   confirm that explicit action keeps the picker visible.

## Acceptance criteria

- ✅ The empty, create-allowed state is headed **Start planning** and contains exactly the two
  available next steps: **New company** and **Ask an admin for an invite**; the old **No companies
  yet / Create your first one** mixed message is absent.
- ✅ The empty, create-forbidden state shows only the invite step and says the user should ask an
  admin; it does not render a disabled or hidden-behind-copy create promise.
- ✅ The populated state uses **“Choose a company to plan, or create another one.”** only when
  `canCreateAccount` is true; at the single-company cap it uses **“Choose a company to plan.”** and
  hides **New company**.
- ✅ Every populated company row shows its honest access posture (`data-testid="company-role"`): a
  membership role only in authenticated mode, **Demo access** in the in-memory demo, or **Open
  access** on an auth-off persisted server.
- ✅ The create form captures Company name, Week starts on, Timezone and read-only Language
  (English), then activates the created company and lands on Schedule.
- ✅ The create form has no company-colour control; the account receives the default preset
  automatically.
- ✅ A server-side permission/cap refusal remains enforced even if the UI affordance is bypassed.
- ✅ A browser reload auto-opens exactly one valid company without persisting `activeAccountId` or
  navigating away from the requested route.
- ✅ First entry, explicit switching, multiple companies, no companies, unavailable membership and
  invite handoff continue through their existing safe picker/handoff boundaries.
