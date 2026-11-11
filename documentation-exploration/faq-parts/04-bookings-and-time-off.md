## Bookings

<span id="faq-book-start-allocation"></span>

### How do I book work for someone?

On **Schedule**, select **Show filters** and choose **Work** if time-off drawing is selected. Choose the person’s row and select **+**, or drag across empty dates on that row. **New allocation** opens for that person. Choose a **Project** and **Activity**, check the dates and amount, then select **Save**. The saved booking appears on that person’s row. Only Editors, Admins and Owners can book work.

<span id="faq-book-amount-and-dates"></span>

### Why do I see different date and amount fields?

The company’s scheduling mode controls the form. In **Hours** mode, enter literal **Start** and **End** dates and choose **Hours / day**. In **Days** mode, enter **Days of work** and **Days over**; **End** is derived from the span. **Blocks** also derives the end from **Days over**, but does not measure workload or utilisation. Keep the company’s chosen mode; don’t change it just to use a different form.

<span id="faq-book-edit-cancel"></span>

### How do I change a booking or leave it as it is?

An Editor, Admin or Owner can select the booking bar to open **Edit allocation**. Its **Assignee**, project, activity, dates and other saved values are filled in. Make the change and select **Save** to update that booking. Select **Cancel** or the dialog’s close control to leave without saving; the existing booking stays as it was. If the schedule changed while the form was open, close it, reopen the booking, review the current values and apply your change again.

<span id="faq-book-duplicate"></span>

### What does **Duplicate** do?

For an eligible booking, an Editor, Admin or Owner can select **Duplicate** in **Edit allocation** to create a separate copy from the form’s current values; the dialog then closes. The original keeps its saved values; use **Undo** on Schedule if you duplicated it by mistake. Repeated bookings cannot be duplicated from an individual occurrence.

<span id="faq-book-delete-allocation"></span>

### How do I remove a booking, and can I undo it?

An Editor, Admin or Owner can select **Delete**, which asks for confirmation. If the booking repeats, choose whether to remove only this occurrence or this and future occurrences. Cancel the confirmation to keep the booking. After confirming, use **Undo** on Schedule to restore a mistaken deletion during the current page session.

<span id="faq-book-inline-activity"></span>

### The activity I need is missing. Can I add it from the booking form?

If the company has enabled **Inline activity creation**, enter a name in the new activity field and select **Add activity**. The activity is created in the scope selected in the form and becomes the booking’s activity. If that control is not available, an Editor, Admin or Owner can add it on **Activities**; inline creation is a company setting, not a per-booking option.

<span id="faq-book-change-assignee"></span>

### How do I give a booking to someone else?

An Editor, Admin or Owner can drag a booking onto another person’s row. Normally this keeps its start and number of working days, so the end can change with the new pattern. With **Ignore working days**, the span uses calendar days; external-party bookings use literal dates. Or open the bar and change **Assignee** in **Edit allocation**. In that form, **Days** and **Blocks** derive the end from **Days over**, while **Hours** keeps the selected **Start** and **End** dates. Check the destination’s working pattern and availability dates. CapacityLens does not choose a replacement person for you.

<span id="faq-book-placeholder-project"></span>

### Why can’t I change the project for a placeholder booking?

A placeholder is tied to one **Bound project**. Its booking stays with that project, and the **Activity** choices are limited to activities for that project and shared **All projects** activities. Choose a different placeholder or a person resource if the work belongs to another project.

<span id="faq-book-save-errors"></span>

### Why won’t the booking form save?

Fix marked fields: choose an activity and valid dates, with **Hours / day** or **Days of work** above zero. New bookings must start on a working day outside time off or a closure. If the schedule changed, reopen and reapply.

If a save fails or its result is uncertain, the error notice stays until you close it. A bar on Schedule does not prove the server saved it, and a reload cannot recover an unsaved change. Check Schedule before repeating the change; it may already have saved.

<span id="faq-book-repeat-patterns"></span>

### Do repeating bookings and repeating time off work the same way?

No. Bookings can repeat weekly, every two, three or four weeks, or monthly. Set **Repeat until** no more than six calendar months after the start; the preview shows linked bookings, and one **Undo** removes the batch. Later, edit an occurrence on its own or delete it with future occurrences. Repeating time off has a finite preview and cutoff; the cutoff includes an entry that starts on that date. After saving, each time-off entry is independent, with no continuing series. A Viewer asks a planner to enter time off.

<span id="faq-book-task-field"></span>

### Where is the optional **Task** field?

The one-line **Task** field appears in the booking form only when an Editor, Admin or Owner has enabled **Show task field in schedule** in company settings. It adds context to the booking; it does not replace the required **Activity** or turn CapacityLens into a task list. If the field is absent, leave it out or ask a planner whether the company needs it.

## Time off and closures

<span id="faq-book-add-time-off"></span>

### How do I record someone’s time off?

On **Time off**, select **Add time off**. Choose the **Resource**, **Start**, **End** and **Type**—**Holiday**, **Sick**, **Unpaid** or **Other**—then select **Save**. Time off uses whole days; the dates appear in the list and as a hatched block on Schedule. Only an Editor, Admin or Owner can add or change time off. Viewers cannot submit a holiday request in CapacityLens; ask the person who plans the schedule to enter it.

<span id="faq-book-edit-delete-time-off"></span>

### Can I correct or remove a time-off entry?

An Editor, Admin or Owner can use **Edit** beside the entry to update its dates, type or note, then save. Only Owners and Admins can see or edit time-off notes. When an entry came from a repeat, editing it changes only that entry. **Delete** asks for confirmation; cancel to keep it, or confirm to remove it from the list and Schedule. A mistaken deletion can be restored with **Undo** during the current page session.

<span id="faq-book-time-off-type"></span>

### Why doesn’t the Time off list show whether it is holiday or sick time?

The list is designed to scan who is away and for how long. The type label appears on the matching time-off block on **Schedule** when the block is wide enough, and screen readers always announce it. Open that view to distinguish **Holiday**, **Sick**, **Unpaid** or **Other**.

<span id="faq-book-old-time-off"></span>

### An old absence disappeared from the list. Was it deleted?

No. **Time off** lists entries that end in the current company week or later. Past entries are hidden from this forward-looking list but remain in the schedule data. Current and upcoming personal time off is grouped under each resource.

<span id="faq-book-company-closures"></span>

### Who can add or change a company closure?

An Editor, Admin or Owner can open **Time off → Company closures** and select **Add closure**. Enter its **Name**, **Start** and **End**, then save. To change one, select **Edit**, update the fields and save. A closure makes every person and placeholder unavailable on those dates; existing bookings stay visible so you can review any overlap. Closures are one-off dates, not repeating personal time off.

<span id="faq-book-delete-closure"></span>

### What happens when I delete a company closure?

An Editor, Admin or Owner can select **Delete** beside the closure and confirm. Cancel to keep it. Once removed, the closure band disappears from Schedule and people become available where their usual working days and other absences allow. Existing bookings keep their dates; deleting the closure does not move them.
