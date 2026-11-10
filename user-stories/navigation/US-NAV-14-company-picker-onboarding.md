# US-NAV-14 — Set up and open the installation company

As an initial admitted person, I want to initialize the empty installation’s company so that the company can begin planning.

**Status:** Current

**Access:** Initial admitted identity only during empty-install setup; subsequent entry requires membership

**Entry:** Production: Set up your company screen; demo: company picker and temporary company creation ([US-NAV-17](US-NAV-17-demo-mode.md))

**Documentation:** [Create Your Company](../../docs-src/owner/create-your-company.md)

**Source:** [CompanySetup.tsx](../../apps/frontend/src/auth/CompanySetup.tsx); [AccountPicker.tsx](../../apps/frontend/src/components/accounts/AccountPicker.tsx)

## Acceptance criteria

| Field          | Control    | Required/default/conditions                               |
| -------------- | ---------- | --------------------------------------------------------- |
| Company name   | Text input | Required; valid supported name; disabled while submitting |
| Week starts on | Select     | Defaults to Monday; Monday or Sunday                      |
| Timezone       | Select     | Defaults to `Etc/GMT`; supported time zones only          |

- Create company submits setup; Sign out ends setup without creating a company. Success opens the installation company; a failed request remains visible for retry.
