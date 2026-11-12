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
  trigger["DialogTrigger opens Dialog"] --> primitive["Radix DialogContent manages modal focus"]
  primitive --> trap["focus scope traps Tab and supports Escape"]
  close["close action dismisses Dialog"] --> restore["Radix restores focus to trigger"]
```

**Code references:** [dialog.tsx](../../apps/frontend/src/components/ui/dialog.tsx); [alert-dialog.tsx](../../apps/frontend/src/components/ui/alert-dialog.tsx)
