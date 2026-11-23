# US-KBD-02 — Use dialogs with a keyboard

As a keyboard user, I want focus managed within dialogs so that I can complete or dismiss them without losing my place.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer; actions remain role-gated

**Entry:** Any dialog open, Tab, Escape, and close action

**Documentation:** [Help](../../docs-src/using/help.md)

**Source:** [dialog.tsx](../../apps/frontend/src/components/ui/dialog.tsx)

## Acceptance criteria

- Opening moves focus into the dialog, Tab stays within it, Escape closes where supported, and focus returns to the opener.

## User flow

```mermaid
flowchart TD
  human1["Open a dialog"]
  human2["Focus enters the dialog"]
  human3["Tab stays within it"]
  human4["Escape or close dismisses where supported"]
  human5["Focus returns to the opener"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
  human4 --> human5
```

## Code flow

```mermaid
flowchart TD
  open["A dialog owner opens its Radix content"] --> type{"Which owner handles close?"}
  type -->|trigger-backed Dialog| plain["DialogContent relies on the primitive focus scope and close behavior"]
  plain --> restore["On close, the primitive can restore an available trigger"]
  type -->|FormDialog Escape| policy["requestClose checks warnOnDirty and dirtyRef"]
  type -->|FormDialog outside pointer| outside{"Nested overlay or right or Ctrl-click?"}
  outside -->|yes| keep["Ignore the outside dismissal"]
  outside -->|no| policy
  policy -->|dirty and warned| warn["Publish unsaved-changes notice; keep the form open"]
  policy -->|otherwise| close["Call onClose"]
  close --> custom["FormDialog cancels default close autofocus; on unmount restoreFocus tries invoker then main"]
  type -->|PersonScheduleSheet| sheet["Controlled Sheet onOpenChange; onCloseAutoFocus calls onRestoreFocus"]
```

**Code references:** [dialog.tsx:54](../../apps/frontend/src/components/ui/dialog.tsx#L54) · [dialogs.tsx:73](../../apps/frontend/src/components/common/dialogs.tsx#L73) · [dialogs.tsx:109](../../apps/frontend/src/components/common/dialogs.tsx#L109) · [dialogs.tsx:152](../../apps/frontend/src/components/common/dialogs.tsx#L152) · [PersonScheduleSheet.tsx:30](../../apps/frontend/src/components/person-schedule/PersonScheduleSheet.tsx#L30)
