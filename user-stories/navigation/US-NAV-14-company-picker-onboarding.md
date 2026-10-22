# US-NAV-14 — Set up and open the installation company

**Area:** Navigation & shell · **Persona:** Company Owner or teammate · **Linked automated coverage:** `apps/backend/tests/functional/auth/first_company_setup.spec.ts`, `apps/backend/tests/unit/company_initialize_command.spec.ts`, `apps/frontend/src/components/accounts/AccountPicker.test.tsx`, `apps/backend/tests/functional/retired_routes.spec.ts`, `e2e/first-company.auth.spec.ts`, `e2e/onboarding.db.spec.ts`, `e2e/scheduler-persistence.auth.spec.ts`

**Documentation:** [Access your company](../../docs-src/owner/create-your-company.md)

## Goal

Open the installation company directly after sign-in without choosing a company each time.

## Why

Small agencies need a direct path from installation setup to planning. Keeping the production company decision on the server avoids confusing company-switching controls while preserving company-scoped authorization for every request. The in-memory demo remains a separate, temporary way to explore multiple fictional companies.

## How (end-to-end)

1. Sign in to an installation with a provisioned company and an active membership. The company opens on Schedule.
2. Reload the page and sign in again if prompted. The server's company summary opens the same company and preserves the requested route.
3. Confirm the production interface has no company picker or switch-company action. If the server reports more than one stored company, the app explains that an administrator must resolve the installation; it never offers a choice.
4. On an empty installation, create the initial identity through normal sign-in setup. On **Set up your company**, enter **Company name** and select **Create company**. Schedule opens with that identity as Owner; the service keeps running.
5. In the in-memory demo, sign in and use its picker to switch between fictional companies or create another temporary one.

## Acceptance criteria

- ✅ First-company setup is available in the browser to the initial authenticated identity only while the installation has no company or membership. One company-name field creates canonical defaults, Internal client and one active Owner atomically, leaves credentials and admission unchanged, and refuses competing or second initialization. A failed save keeps the draft and visible retry feedback.
- ✅ Server company-creation and generic batch write routes are retired and return 404.
- ✅ Production asks the server for the installation company. Exactly one accessible company opens automatically; zero companies offer first-run setup only to the initial authenticated identity; other identities show the empty access state; multiple stored companies fail closed with an actionable error and no company list.
- ✅ Production never renders company selection, switching or additional-company creation controls, including during loading and recovery states.
- ✅ The active company id remains session-only. Existing account-scoped APIs continue to authorize requested ids from server-side membership; an id alone grants no authority.
- ✅ The demo keeps its volatile multi-company picker and switching behavior.
- ✅ Member and resource links continue to attach members to scheduled resources within their company.
