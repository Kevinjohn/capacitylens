# US-SET-26 — Anonymise all people

As an Owner, I want to anonymise all people so that identifying details and dependent notes are removed company-wide.

**Status:** Current
**Access:** Owner.
**Entry:** Settings → Data and support → Anonymise all people
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [CompanyAnonymiseSection.tsx](../../apps/frontend/src/components/settings/CompanyAnonymiseSection.tsx), [PasswordConfirmationDialog.tsx](../../apps/frontend/src/auth/PasswordConfirmationDialog.tsx)

## Acceptance criteria

| Field    | Control        | Required/default/conditions                          |
| -------- | -------------- | ---------------------------------------------------- |
| Password | Password input | Required after confirmation; current Owner password. |

- **Anonymise all people** opens confirmation; **Cancel** leaves data unchanged. Confirming continues to the password dialog on the server.
- **Continue** anonymises identifying resource details and dependent notes. Company, catalogue and membership records remain.

## User flow

```mermaid
flowchart TD
A["Open Settings: Anonymise all people"] --> B["Review the irreversible anonymisation warning"]
B -->|cancel| C["Leave data unchanged"]
B -->|confirm| F["Owner enters the current password"]
F -->|cancel| C
F -->|continue| G{"Action accepted?"}
G -->|yes| H["Reload the anonymised company data"]
G -->|no or uncertain| I["Read the error; reload when instructed"]
```

## Code flow

```mermaid
flowchart TD
  section["CompanyAnonymiseSection requires company:anonymise and opens warning"] -->|Cancel| close["Dismiss without posting"]
  section -->|Continue| proof["PasswordConfirmationDialog issues anonymise proof for company and empty intent"]
  proof -->|Cancel| section
  proof -->|Refused| inline["Show proof refusal in the dialog"]
  proof -->|confirmationId| suspend["runSuspendedReplacement checks readiness and suspends planning writes"]
  suspend -->|Blocked| notice["Show notice without sending"]
  suspend -->|Ready| endpoint["CompanyAnonymisationsController checks live Owner and consumes proof in its transaction"]
  endpoint -->|Refused| resume["Resume writes and show error"]
  endpoint -->|Authorized| scrub["anonymiseResources retains IDs and scrubs all resource kinds and dependent notes"]
  scrub --> commit["Discard restoration groups and undo history; record audit and revision"]
  commit -->|204| reload["Keep writes suspended and reload the page"]
  suspend -->|Commit uncertain| require["Keep writes suspended and require full reload"]
  require --> reload
```

See [password proof issuance](../data/US-DAT-08-preview-exact-import.md#code-flow) for the shared authorization callback. Company anonymisation uses an empty intent.

**Code references:** [CompanyAnonymiseSection.tsx](../../apps/frontend/src/components/settings/CompanyAnonymiseSection.tsx#L43) · [CompanyAnonymiseSection.tsx](../../apps/frontend/src/components/settings/CompanyAnonymiseSection.tsx#L89) · [company_anonymisations_controller.ts](../../apps/backend/app/controllers/company_anonymisations_controller.ts#L23) · [anonymise.ts](../../apps/backend/app/services/anonymise.ts#L12) · [transitions.ts](../../packages/shared/src/domain/lifecycle/transitions.ts#L101) · [anonymise.spec.ts](../../apps/backend/tests/functional/anonymise.spec.ts#L229) · [anonymise.spec.ts](../../apps/backend/tests/functional/anonymise.spec.ts#L415) · [suspendedReplacement.ts](../../apps/frontend/src/store/suspendedReplacement.ts#L101)
