# US-KBD-05 — Associate validation errors with fields

As a screen-reader user, I want invalid fields connected to their error messages so that I can locate and correct them.

**Status:** Current

**Access:** Owner, Admin, Editor; forms accessible to Viewer remain read-only

**Entry:** Invalid form control and its validation message

**Documentation:** [Help](../../docs-src/using/help.md)

**Source:** [useFieldError.ts](../../apps/frontend/src/hooks/useFieldError.ts)

## Acceptance criteria

- Invalid controls expose aria-invalid and reference their visible error; the association clears when corrected.

## User flow

```mermaid
flowchart TD
  human1["Submit an invalid form"]
  human2["Invalid control is marked and associated error appears"]
  human3["Focus reaches the invalid field"]
  human4["Correct it"]
  human5["invalid state and error association clear"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
  human4 --> human5
```

## Code flow

This focus trace applies to forms that call useFieldErrorFocus. The Add client browser test checks field-to-alert association, independently of whether the form calls that hook.

```mermaid
flowchart TD
  submit["AllocationDialog submit invokes validation or write handling"] --> fail["fail from useFieldError stores message and optional field key"]
  fail --> kind{"Does the error name a field?"}
  kind -->|yes| field["Field sets aria-invalid and refers to the matching FieldError ID"]
  kind -->|no| alert["FieldError is a form-level alert with a focus target"]
  field --> focus["useFieldErrorFocus locates the described control and scrolls/focuses it"]
  alert --> focusAlert["useFieldErrorFocus locates the alert by ID and scrolls/focuses it"]
```

**Code references:** [allocationSubmit.ts:222](../../apps/frontend/src/components/scheduler/allocationSubmit.ts#L222) · [useAllocationDialogState.ts:123](../../apps/frontend/src/components/scheduler/useAllocationDialogState.ts#L123) · [AllocationScheduleFields.tsx:270](../../apps/frontend/src/components/scheduler/AllocationScheduleFields.tsx#L270) · [textFields.tsx:60](../../apps/frontend/src/components/common/fields/textFields.tsx#L60) · [useFieldError.ts:18](../../apps/frontend/src/hooks/useFieldError.ts#L18) · [useFieldError.ts:34](../../apps/frontend/src/hooks/useFieldError.ts#L34) · [dialog-layout.db.spec.ts:124](../../e2e/dialog-layout.db.spec.ts#L124)
