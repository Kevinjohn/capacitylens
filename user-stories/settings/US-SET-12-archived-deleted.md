# US-SET-12 — Archive and anonymise records

As a company Editor, I want to archive records and authorised staff to anonymise people so that obsolete or identifying information is handled appropriately.

**Status:** Current — catalogue lifecycle is covered by its owning stories.
**Access:** Owner, Admin, Editor
**Entry:** Resource, Client, Project or Activity archive controls; Settings → Anonymise all people
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [CompanyAnonymiseSection.tsx](../../apps/frontend/src/components/settings/CompanyAnonymiseSection.tsx)

## Acceptance criteria

- Restore archived records from their owning pages. Individual resource anonymisation is Owner/Admin; company-wide anonymisation is Owner-only with password confirmation. See [US-RES-16](../resources/US-RES-16-anonymise-resource.md).
