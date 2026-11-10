---
title: Book work
description: Add a project activity to a person's schedule for the dates and amount they can take on.
audience: 'Editor, Admin, Owner'
screen: 'Schedule'
---

# Book work

Editors, Admins and Owners can book work on **Schedule**. If time-off drawing is selected, open **Show filters** and choose **Work** first.

1. **Choose a person and dates.** Select **+** on that person's row to open **New allocation**. Or drag across working days on the row to set the date span.
2. **Choose the work.** Set **Project**, then choose **Activity**. For the example in [Add work](04-add-work.md), choose **Wayne Enterprises → Website refresh** and **Design**.
3. **Set the amount.** In **Days** mode, the form has **Days of work** and **Days over**. With a Monday–Friday company and a full-day person, set **Start Date** to Monday, **Days of work** to `1`, and **Days over** to `2`. Check that the calculated end is Tuesday. This books one day of work across two full working days.
4. **Save and check the result.** Select **Save**. The booking appears on the person's row. A bar can appear before the server confirms a save; if the page shows **Changes aren’t being saved right now — we’ll keep retrying**, leave it open and wait for the warning to clear.

A new booking normally starts as **Confirmed**. Choose **Tentative** for work not yet won; tentative work still counts towards utilisation.

## Other project choices and units

**Internal** is for internal activities. **No specific project** is for All-projects activities without project attribution. A real project offers its project-specific activities and shared All-projects activities.

New companies default to **Days**, but an existing company may use **Hours** or **Blocks**. Use the amount fields shown in the form; do not change company settings just for this booking. In Blocks mode, bookings do not measure capacity. For a saved booking that needs a change, see [Resolve overbooking](08-resolve-overbooking.md). A Viewer can inspect the schedule with [Check your week](09-check-your-week.md).
