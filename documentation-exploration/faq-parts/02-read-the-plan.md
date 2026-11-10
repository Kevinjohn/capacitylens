## Schedule and capacity

<span id="faq-plan-navigate-schedule"></span>

### How do I move through the Schedule?

Use **Prev** and **Next** to move the window by one week, or select **Today** to return to the current date. **Weeks visible** offers 1, 2, 4, 6, or 8 weeks. The timeline aligns to your company’s configured week start when you change the range or scroll. To jump to a date, press **⌘K** on Mac or **Ctrl+K** on Windows, type a valid date in `YYYY-MM-DD` format (for example, `2026-11-23`), then choose **Go to date 2026-11-23**. The toolbar itself has no date picker.

<span id="faq-plan-read-capacity-cues"></span>

### What do the Schedule’s capacity cues mean?

When **Use disciplines** is on, resource rows are grouped by discipline. When disciplines are off, people share one Resources group unless there are Supplementary people; then engagement separates Studio and Supplementary groups. Their utilisation summaries describe the visible date range; changing **Weeks visible** changes that range. A red utilisation flag is different: it warns about over-capacity in the next 14 days, even when you are viewing another period. A day is over capacity only when booked work exceeds that day’s available capacity. A visible-window average below 100% can still include an overloaded day; check the red daily bands.

<span id="faq-plan-read-bars-and-days"></span>

### How can I tell work, time off, and unavailable days apart?

Work appears as labelled bars. Tentative, confirmed, and completed work have different visual treatments, and a note marker appears when a booking has a note. Time off appears as a labelled hatched block. Non-working and time-off days are shaded when the Schedule is zoomed in closely enough to show day-level detail. A vertical line marks today only while today is in view.

<span id="faq-plan-create-work"></span>

### How do I start a new booking from the Schedule?

Editors, Admins, and Owners can open the filter row with **Show filters** and choose **Work**, then drag across empty space in a resource’s row. The **New allocation** form opens with that resource and date range filled in. The **+** on a resource row also opens a form for the selected mode: **Work** opens **New allocation**, while **Time off** opens the time-off form. The **+** preselects that resource and starts from the left edge of the visible timeline. Review the form before saving.

<span id="faq-plan-create-time-off"></span>

### How do I add time off from the Schedule?

Editors, Admins, and Owners can open the filter row with **Show filters** and choose **Time off**. Then drag across the resource’s row for the dates away. The time-off form opens with that resource and date range filled in. This mode starts a time-off entry even when work bars cross the area you drag across.

<span id="faq-plan-change-allocation"></span>

### How do I change a booking’s dates or assignee?

An Editor, Admin or Owner can drag the body of a booking’s bar along its current row to move its dates. Drag either edge to change its date range; a booking must remain at least one day long. To change who it is assigned to, drag the bar to another resource’s row. If that destination is a placeholder for a different project, the change is rejected, the booking stays where it was, and the Schedule explains why.

<span id="faq-plan-undo-redo"></span>

### How do I undo or redo a planning change?

Editors, Admins, and Owners can use **Undo** or **Redo** in the toolbar, or press **⌘Z** / **Ctrl+Z** to undo and **⌘⇧Z** / **Ctrl+Shift+Z** to redo. A toolbar button is disabled when there is no change to reverse or reapply. Shortcuts do not run while you are typing, while text composition is active, or while a dialog owns input. Undo history lasts while this page stays open; reloading or another person’s change can clear it. It does not follow you to another device.

<span id="faq-plan-overlapping-bars"></span>

### Why are some bookings shown on separate lines?

Bookings that overlap in time for the same person are stacked into separate lanes so each remains visible. Bookings that do not overlap can share a lane. This layout changes how bars are drawn; it does not create additional resources or change the plan.

<span id="faq-plan-inspect-booking"></span>

### How can I read a booking without opening its form?

Hover over a booking or move keyboard focus to it to show its detail popover. It includes the available dates, status, and notes. A person’s avatar opens a read-only side sheet with their dated work and time off for the current company week and the following three weeks; closing it returns you to the avatar you opened.

<span id="faq-plan-overview-period-and-display"></span>

### Who can open Overview, and how do I change what it shows?

Overview access is set by an Owner or Admin. It defaults to Owners and Admins, with options for **Admins**, **Admins & Editors**, or **Everyone**. If the page is missing, ask your Owner or Admin to check this setting; being able to read Schedule does not automatically grant Overview access.

On Overview, choose 4, 8, or 12 weeks. It starts at 4 weeks each time you open the page, and its first column covers the remainder of the current week. Choose **Ledger** or **Load curve** to change how cells display capacity. **Tentative**, **Has availability**, and **Totals** control whether tentative work, people with availability, and weekly totals are included in the display; they start on, off, and off respectively. You can collapse discipline groups. When placeholders are enabled, they appear as unassigned demand.

Schedule utilisation follows its visible date range, while its red warning always looks 14 days ahead. Overview uses its own capacity display and filters. Its **Tentative**, **Has availability**, and **Totals** controls change displayed demand, people, and weekly summaries, so its figures are not directly interchangeable with Schedule’s.

## Find and filter work

<span id="faq-plan-search-people"></span>

### How do I find a person on Schedule?

Open the filter row with **Show filters**, then type a name or role in **Search people…**. The Schedule shows matching resource rows. Clear the search text to restore the rows that match your other active filters.

<span id="faq-plan-filter-discipline"></span>

### How do I show one discipline at a time?

When the company has **Use disciplines** enabled, use **Filter by discipline** in the filter row to choose a discipline. The Schedule shows that discipline’s resource group. Choose **All disciplines** to show the groups again. You can also select a discipline heading to collapse its rows; select it again to expand them.

<span id="faq-plan-filter-client-project"></span>

### How do client and project filters work together?

Choose a client in **Filter by client** to show that client’s bookings. Then use **Filter by project** to narrow the results; the project choices follow the selected client. A client or project filter changes which bars are visible, but capacity figures still include all work. Select **Clear Filters** to return to the full schedule.

<span id="faq-plan-filter-activity"></span>

### How do I find work by activity?

Use **Filter by activity** in the expanded filter row to focus on a type of work, including internal or all-projects activities. The filter narrows the visible work but does not recalculate capacity from only the matching bars. **Show unallocated** can add resources with no matching work to the results.

<span id="faq-plan-hide-tentative"></span>

### Can I hide tentative bookings from view?

Select **Tentative** to show tentative bars; select it again to hide them. Hiding those bars changes what you see, not the capacity calculation: tentative bookings still count toward capacity.

<span id="faq-plan-show-unallocated"></span>

### How do I see people without work matching my filter?

After you choose a client, project, or activity filter, check **Show unallocated** in the expanded filter row. Resources without matching work appear as dimmed rows, with capacity still based on all of their work. This option is available only while one of those work filters is active.

<span id="faq-plan-clear-filters"></span>

### How do I get back to the full Schedule after filtering?

Select **Clear Filters** to reset the search, selection filters, **Tentative**, and **Show unallocated** together. If your filters match no resources, the Schedule shows an empty state with a **Clear filters** action. Clearing the filters restores the rows.

<span id="faq-plan-filter-row-hidden"></span>

### I can’t see the filters. Where did they go?

Select **Show filters** to open the filter row. It contains search, client, project and activity filters, plus **Clear Filters**. The discipline filter appears when the company uses disciplines; Editors, Admins and Owners also see the **Work** / **Time off** draw-mode controls. Select **Hide filters** to collapse the row. Hiding it removes the controls from view but does not itself clear the current selections.

## Keyboard and form help

<span id="faq-plan-keyboard-bars"></span>

### Can I use booking bars without dragging?

Yes. Focus a booking bar with the keyboard. Its accessible name identifies it; press **Enter** to open editing when you have permission. Available arrow-key commands move or resize the bar. Viewers can inspect the Schedule but cannot make planning changes.

<span id="faq-plan-keyboard-dialogs"></span>

### What happens to keyboard focus when a dialog opens?

When a dialog opens, focus moves into it and stays within the dialog as you press **Tab**. Press **Escape** to close it where that action is supported, or use its close control. Focus returns to the control that opened the dialog.

<span id="faq-plan-form-errors"></span>

### How do I find and correct a form error?

An invalid field is marked and connected to its visible error message, so assistive technology can identify both together. Correct the field and its error association clears. If a form will not save, review the marked fields and their messages before trying again.

<span id="faq-plan-read-grid-with-screen-reader"></span>

### Can I understand the Schedule with a screen reader?

With a screen reader, you can move through resource rows and dates and hear applicable capacity and time-off details. You can also focus a booking bar to hear its details; press **Enter** to open editing when your access allows it.

<span id="faq-plan-form-width"></span>

### Why do form labels move above their fields?

On wider screens, management forms align labels beside their fields. At narrower widths, labels stack above the fields to keep them associated and readable. Required and conditional fields remain labelled. If a field is unclear, use its visible label and any validation message rather than relying on its position alone.

<span id="faq-plan-report-accessibility-problem"></span>

### How do I report an accessibility problem?

Use the support route your company gave you. Name the screen and control, describe what you were trying to do, and say where you got stuck. If relevant, include the keyboard or assistive technology you were using and any error message shown. This helps identify the task without assuming the same issue occurs on every screen.
