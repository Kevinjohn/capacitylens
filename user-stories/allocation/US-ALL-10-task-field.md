# US-ALL-10 — Add an optional task to an allocation

**Area:** Allocation editor and schedule details · **Persona:** Studio manager

## Goal

Give an allocation a short task description that helps the team understand the work behind a
booking without changing its activity, dates or capacity.

## How (end-to-end)

1. Open **Settings** and enable **Show task field in schedule**.
2. Create or edit an allocation. The single-line **Task** field appears below the activity controls.
3. Enter a short description and save.
4. Hover or focus the allocation bar to read the task above its Notes. The same task appears in the
   person's schedule drawer when that view is available.
5. Turn the setting off. The field and displayed task are hidden, but the saved text is preserved.
6. Turn it on again. The task is available again, and a different account's setting does not change it.

## Acceptance criteria

- ✅ **Show task field in schedule** is a workspace setting, off by default and shared by everyone in
  that account.
- ✅ The editor shows an optional single-line **Task** field when enabled, and saves it with the
  allocation without affecting scheduling calculations.
- ✅ Enabled schedule details show a populated task above Notes; empty tasks do not create empty
  detail rows.
- ✅ Disabling the setting hides the form field and schedule detail without erasing the stored task;
  re-enabling it restores the task.
- ✅ Account-scoped reads and writes keep task text and the setting isolated between accounts.
