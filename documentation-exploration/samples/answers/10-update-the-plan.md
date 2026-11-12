---
title: What should I do when a plan change does not save?
description: Read the save warning, verify uncertain results, refresh conflicts and use page-local Undo with care.
audience: 'Editor, Admin, Owner'
screen: 'Schedule'
---

# What should I do when a plan change does not save?

Planning changes need a server connection. CapacityLens does not save scheduling data in the browser for recovery after you close or reload the page. Keep the page open while a save warning is visible; the app keeps retrying. Fix the connection and wait for the warning to clear. Reloading before a change is saved discards that unsaved edit.

If someone else changed the company plan while your form was open, your save is refused and the latest plan is loaded. Close and reopen the form, review the current booking, then reapply your change. Do not assume your original edit was saved.

If the app says it could not confirm a result, the server may have saved it. Wait for the latest plan to load, then inspect the affected row before trying the action again. Repeating a creation without checking can create duplicate work. If a form is stale, reopen it against the latest plan before editing again.

## When does Undo help?

Schedule **Undo** and **Redo** apply to eligible booking changes in this page session. They are not a general history for every page. History is cleared by a reload, changing company context or an outside plan change; Undo is not available across devices. For a mistaken recent booking edit, choose **Undo** in the Schedule toolbar, then verify the row. If the saved state is uncertain, check the latest plan first.

After correcting the connection or refreshing the plan, confirm the person's dates, amount and over-capacity markers. See [Book work](07-book-work.md) to add a replacement booking or [resolve overbooking](08-resolve-overbooking.md) to adjust one.
