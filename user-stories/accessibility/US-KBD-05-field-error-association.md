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

```mermaid
flowchart TD
  form["form calls useFieldError.fail(field, message)"] --> state["error and errorField state"]
  state --> field["TextField sets aria-invalid and aria-describedby"]
  state --> message["FieldError renders matching id"]
  focus["useFieldErrorFocus focuses associated control"] --> field
```

**Code references:** [useFieldError.ts](../../apps/frontend/src/hooks/useFieldError.ts); [textFields.tsx](../../apps/frontend/src/components/common/fields/textFields.tsx); [field.tsx](../../apps/frontend/src/components/ui/field.tsx)
