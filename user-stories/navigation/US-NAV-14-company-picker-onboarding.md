# US-NAV-14 — Set up and open the installation company

**Area:** Navigation & shell · **Persona:** Company Owner or teammate · **Linked automated coverage:** `apps/backend/tests/unit/company_initialize_command.spec.ts`, `apps/frontend/src/components/accounts/AccountPicker.test.tsx`, `apps/backend/tests/functional/retired_routes.spec.ts`, `e2e/onboarding.db.spec.ts`, `e2e/scheduler-persistence.auth.spec.ts`

**Documentation:** [Access your company](../../docs-src/owner/create-your-company.md)

## Goal

Open the installation company directly after sign-in without choosing a company each time.

## Why

Small agencies need a direct path from installation setup to planning. Keeping the production company decision on the server avoids confusing company-switching controls while preserving company-scoped authorization for every request. The in-memory demo remains a separate, temporary way to explore multiple fictional companies.

## How (end-to-end)

1. Sign in to an installation with a provisioned company and an active membership. The company opens on Schedule.
2. Reload the page and sign in again if prompted. The server's company summary opens the same company and preserves the requested route.
3. Confirm the production interface has no company picker or switch-company action. If the server reports more than one stored company, the app explains that an administrator must resolve the installation; it never offers a choice.
4. On an empty installation, create the first identity through normal sign-in setup. The installer stops the service, runs `company:initialize` with the existing email and company name, then restarts it. Sign in normally to open the initialized company as Owner.
5. In the in-memory demo, sign in and use its picker to switch between fictional companies or create another temporary one.

## Acceptance criteria

- ✅ First-company initialization requires a stopped server and exactly one existing identity with a currently enabled sign-in method. It creates canonical company defaults, Internal client and one active Owner atomically, leaves identity credentials and admission unchanged, and refuses a second initialization.
- ✅ Server company-creation and generic batch write routes are retired and return 404.
- ✅ Production asks the server for the installation company. Exactly one accessible company opens automatically; zero companies show the empty access state; multiple stored companies fail closed with an actionable error and no company list.
- ✅ Production never renders company selection, switching or additional-company creation controls, including during loading and recovery states.
- ✅ The active company id remains session-only. Existing account-scoped APIs continue to authorize requested ids from server-side membership; an id alone grants no authority.
- ✅ The demo keeps its volatile multi-company picker and switching behavior.
- ✅ Member and resource links continue to attach members to scheduled resources within their company.
