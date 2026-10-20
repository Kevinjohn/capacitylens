# US-NAV-14 — Set up and open the installation company

**Area:** Navigation & shell · **Persona:** New company Owner or teammate · **Linked automated coverage:** `apps/frontend/src/components/accounts/AccountPicker.test.tsx`, `apps/backend/tests/functional/company_contract_corrections.spec.ts`, `e2e/onboarding.db.spec.ts`, `e2e/scheduler-persistence.auth.spec.ts`

**Documentation:** [Create your company](../../docs-src/owner/create-your-company.md)

## Goal

Set up the installation's first company, then go straight to its schedule without choosing a company each time.

## How (end-to-end)

1. On an empty server installation, complete the supported first-Owner setup and open **Set up your company**.
2. Enter the company name, week start, timezone and language. On a server deployment, choose whether to add example data.
3. Create the company and confirm it opens on Schedule.
4. Reload the page and sign in again if prompted. The server's company summary opens the same company and preserves the requested route.
5. Confirm the production interface has no company picker or switch-company action. If the server reports more than one stored company, the app explains that an administrator must resolve the installation; it never offers a choice.
6. In the in-memory demo, sign in and use its picker to switch between the fictional companies. Demo data remains temporary.

## Acceptance criteria

- ✅ First-company setup remains available through the existing supported setup path and creates the company, built-in Internal client and Owner membership atomically.
- ✅ Once a company exists, ordinary company creation is refused by both company routes and generic batch writes.
- ✅ Production asks the server for the installation company. Exactly one accessible company opens automatically; zero companies retain the supported setup or invite entry; multiple stored companies fail closed with an actionable error and no company list.
- ✅ Production never renders company selection, switching or additional-company creation controls, including during loading and recovery states.
- ✅ The active company id remains session-only. Existing account-scoped APIs continue to authorize requested ids from server-side membership; an id alone grants no authority.
- ✅ The demo keeps its volatile multi-company picker and switching behavior.
- ✅ Member and resource links continue to attach members to scheduled resources within their company.
