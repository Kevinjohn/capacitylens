# US-NAV-14 — Company picker gives one clear next step (empty and populated states)

**Area:** Navigation & shell · **Persona:** New owner or invited teammate · **Linked automated coverage:** `src/components/accounts/AccountPicker.test.tsx` (empty-state copy, permission branch, multi-company copy and no onboarding colour choice), `e2e/onboarding.spec.ts` (create flow), `e2e/onboarding.db.spec.ts` (server permission/cap enforcement)

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

## Acceptance criteria

- ✅ The empty, create-allowed state is headed **Start planning** and contains exactly the two
  available next steps: **New company** and **Ask an admin for an invite**; the old **No companies
  yet / Create your first one** mixed message is absent.
- ✅ The empty, create-forbidden state shows only the invite step and says the user should ask an
  admin; it does not render a disabled or hidden-behind-copy create promise.
- ✅ The populated state uses **“Choose a company to plan, or create another one.”** only when
  `canCreateAccount` is true; at the single-company cap it uses **“Choose a company to plan.”** and
  hides **New company**.
- ✅ The create form captures Company name, Week starts on, Timezone and read-only Language
  (English), then activates the created company and lands on Schedule.
- ✅ The create form has no company-colour control; the account receives the default preset
  automatically.
- ✅ A server-side permission/cap refusal remains enforced even if the UI affordance is bypassed.
