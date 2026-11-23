# US-NAV-14 — Set up and open the installation company

As an initial admitted person, I want to initialise the empty installation’s company so that the company can begin planning.

**Status:** Current

**Access:** Initial admitted identity only during empty-install setup; subsequent entry requires membership

**Documentation:** [Create Your Company](../../docs-src/owner/create-your-company.md)

**Entry:** Set up your company on an empty installation

**Source:** [CompanySetup.tsx](../../apps/frontend/src/auth/CompanySetup.tsx)

## Acceptance criteria

| Field          | Control    | Required/default/conditions                               |
| -------------- | ---------- | --------------------------------------------------------- |
| Company name   | Text input | Required; valid supported name; disabled while submitting |
| Week starts on | Select     | Defaults to Monday; Monday or Sunday                      |
| Timezone       | Select     | Defaults to `Etc/GMT`; supported time zones only          |

- Create company submits setup; Sign out ends setup without creating a company. Success opens the installation company; a failed request remains visible for retry.

## User flow

```mermaid
flowchart TD
  bootstrap["Operator issues Account Kit bootstrap invitation"] --> identity["First admitted person accepts invite and signs in"]
  identity --> form["Empty installation shows company setup form"]
  form --> submit["Submit company name and calendar choices"]
  submit -->|accepted| company["Company and Owner membership created; schedule opens"]
  submit -->|invalid, unavailable, or failed| error["Form shows error; draft remains for retry"]
  form -->|Sign out| signedOut["Setup exits without creating company"]
```

## Code flow

```mermaid
flowchart TD
  bootstrap["First admitted confirmed identity signs in after accepting bootstrap invitation"] --> gate["AuthProvider renders CompanySetup from companySetupRequired"]
  gate -->|Sign out| logout["Use the sign-out journey"]
  gate -->|Submit| form["CompanySetup normalizes input and posts first-company setup"]
  form --> controller["FirstCompanySetupController validates request and normalizes optional defaults"]
  controller -->|Invalid or unauthorized| refusal["Show setup failure"]
  controller -->|Valid| guard["withActor checks eligibility under transaction: sole identity, no company or memberships"]
  guard -->|Eligible| create["Create company, Internal client, Owner membership, revision and company.initialized audit atomically"]
  create -->|Created| reread["onCreated rechecks session"]
  guard -->|Concurrent setup or ineligible| conflict["409 triggers onConflict ownership read"]
  conflict -->|Caller owns the sole company| concurrent["Recheck session; require pass with setup cleared"]
  conflict -->|No verified ownership| refusal
  concurrent -->|Access verified| app
  concurrent -->|Cannot verify| recover
  reread -->|Access verified| app["Open company access"]
  reread -->|Cannot verify| recover["Show session refresh failure and ask for reload"]
  form -->|Request failed| refusal
```

See [Sign out of this browser](../account/US-ACCOUNT-04-sign-out.md#code-flow) for sign-out recovery.

**Code references:** [CompanySetup.tsx](../../apps/frontend/src/auth/CompanySetup.tsx#L32) · [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx#L277) · [first_company_setup_controller.ts](../../apps/backend/app/controllers/first_company_setup_controller.ts#L15) · [first_company_setup.ts](../../apps/backend/app/services/first_company_setup.ts#L6) · [initial_company_defaults.ts](../../apps/backend/app/services/initial_company_defaults.ts#L24) · [initial_company_access.ts](../../apps/backend/app/services/initial_company_access.ts#L14) · [first_company_setup.spec.ts](../../apps/backend/tests/functional/auth/first_company_setup.spec.ts#L260)
