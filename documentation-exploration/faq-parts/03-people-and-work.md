## People and schedule rows

<span id="faq-people-add-person-and-sign-in"></span>

### How do I add someone to Schedule, and do they need a sign-in?

An Editor, Admin or Owner can open **Resources** and select **Add resource**. Enter their name, then set a job **Role**, working pattern and other details you use. The **Role** here describes their work; it is separate from their Viewer, Editor, Admin or Owner access. A resource row does not need a sign-in. If the teammate also needs access, an Owner or Admin invites them in **Team & access**. Linking the member to the resource is optional and connects the sign-in to that schedule row. See [Resources](../../docs/using/resources.html).

<span id="faq-people-edit-resource"></span>

### How do I change a person's name or schedule details?

An Editor or above can select the edit control in a **Resources** row, change the fields and save. The form can change their name, job role, engagement, discipline, working days and availability dates. People must keep a name and at least one full or half working day. Changing their pattern or dates recalculates capacity but does not move their existing bookings.

<span id="faq-people-working-days-capacity"></span>

### How do working days affect capacity?

An Editor or above can edit the person in **Resources** and set **Working days** for each weekday. **Full day** is eight hours, **Half day** is four and **Not working** is zero. Capacity counts a day only when both the company and the person mark it as working. There is no separate editable hours-per-day field. If you change a pattern, existing bookings stay on their dates; review any newly over-capacity days.

<span id="faq-people-availability-dates"></span>

### Can I limit when a person is available?

An Editor or above can set **Start date** and/or **End date** in the person's **Resources** form. Both are optional and inclusive. Capacity is zero outside the dates, but existing bookings remain visible and are not moved or removed. To book new work outside the range, update the availability dates first.

<span id="faq-people-engagement"></span>

### What do Studio and Supplementary mean?

An Editor or above can choose **Engagement** in the person's **Resources** form. **Studio** and **Supplementary** place people in different roster sections; they do not change the person's working days or how capacity is counted.

<span id="faq-people-discipline-and-colour"></span>

### Why can't I set a person's colour in Resources?

A person's schedule colour comes from their **Discipline**, not a personal colour field. An Editor, Admin or Owner can add or edit a discipline on **Disciplines** and choose one of its preset colours. A person without a discipline uses the neutral colour. The Discipline field is available when the company has turned on **Use disciplines** and has at least one discipline.

<span id="faq-people-resource-list"></span>

### Why are people split into different sections on Resources?

Resources groups people by engagement once the company has a Supplementary person. Placeholders and external parties have separate sections when those features are on. Archived resources are below the active list. If an expected section is missing, check **Settings → Company features** for **Show placeholders** or **Show external resources**.

<span id="faq-people-favourite-resource"></span>

### How do I keep a resource near the top of the list?

An Editor or above can select the star in a person or external party row to mark it as a favourite. Favourites appear first in their section and the choice is shared with the company. The star is not available on placeholders or to Viewers.

<span id="faq-people-placeholder"></span>

### What is a placeholder, and when should I use one?

A placeholder reserves planned work for a role that is not assigned to a named person yet. An Editor or above can turn on **Show placeholders** in **Settings → Company features**, then select **Add placeholder** in **Resources**. A placeholder must be bound to a project; its name is optional. It follows company working days and has no personal pattern or availability dates. When you assign the work, edit the bookings to choose the person.

<span id="faq-people-external-party"></span>

### How do I list or update an outside company?

An Editor or above can turn on **Show external resources** in **Settings → Company features**. In **Resources**, use **Add external party** to enter the company name and an optional descriptor; edit its row to change either. External parties appear in the schedule for handoffs, but they have no capacity and do not contribute to utilisation.

<span id="faq-people-archive-resource"></span>

### What happens when I archive or restore a resource?

An Editor or above can archive a resource from its **Resources** row. Archiving hides the row from active scheduling while retaining its bookings and time off. Use **Restore** in the archived resources area to return it. Owners and Admins can see the full inactive-data view; Editors can restore eligible resources from the limited archive view.

<span id="faq-people-anonymise-resource"></span>

### Can I remove a former person's details but keep their planning history?

An Owner or Admin can select **Anonymise** for an archived resource. After confirmation, CapacityLens removes the person's identifying details and notes on their bookings and time off, while keeping the resource and its planning links. Anonymising cannot be undone. This action is available only for archived resources.

## Clients and projects

<span id="faq-people-client-project-create-edit"></span>

### How do clients and projects fit together?

A project belongs to one client. Add a client on **Clients**, then select **Add project** on **Projects** and choose that client. An Editor or above can add or edit either. Client forms include a name and preset colour; project forms include a name, client and preset colour. Existing bookings use the updated details after you save. See [Clients and projects](../../docs/using/projects.html).

<span id="faq-people-internal-client"></span>

### Where do I find the Internal client?

**Internal** is the built-in client and does not appear in **Clients** management. The booking form’s **Project** menu includes **Internal** as a scope for internal work; it is not an Internal project record. An **Internal** activity is projectless: its form has no project picker and it saves without project attribution. Internal work remains visible and filterable for everyone and uses neutral grey styling.

<span id="faq-people-code-names"></span>

### Who can set or see a client or project code name?

Only the Owner can turn on **Use code name** and enter the required code name when adding or editing a client or project. Everyone below Owner sees the code name in place of the real name; only the Owner sees the real name. A code name keeps the work identifiable to the team without showing the client or project name.

<span id="faq-people-archive-client"></span>

### What does archiving a client do, and how do I restore it?

An Editor or above can choose **Archive** on a client row and confirm **Archive client?** Its projects and their bookings leave active views, but remain stored. In **Archived clients**, select **Restore** to bring the client back. Restoring a client reveals descendants that remain active; restore any separately archived project or activity on its own.

<span id="faq-people-archive-project"></span>

### What does archiving a project do?

An Editor, Admin or Owner can choose **Archive** on the project row and confirm **Archive project?** Its bookings leave Schedule, including bookings against shared All-projects activities that were attributed to this project. The records remain stored. An Editor or above can restore the project from **Archived projects**; any separately archived child still needs its own restore action.

<span id="faq-people-restore-project"></span>

### How do I bring an archived project back?

With Editor access or above, open **Projects** and find **Archived projects**, then select **Restore** on the project. Its active bookings return to active views. If the project is hidden because its client is archived, select **View archived parent**, then find and restore the client.

<span id="faq-people-phases-unavailable"></span>

### Can I add project phases or assign activities to one?

Phase controls are not currently available in the project or activity forms. Existing phase information remains in the company's data, but there is no current screen for adding or changing it. Use clear project and activity names to distinguish work stages.

## Activities and disciplines

<span id="faq-people-add-activity"></span>

### Which activity kind should I choose?

An Editor or above can open **Activities**, select **Add activity**, enter a name and choose **Kind**. Use **Project-specific** for work tied to one project; it requires that project. Use **All projects** for work that can be booked under several real projects or with **No specific project**. Use **Internal** for projectless internal work. The booking form’s **Project** menu has an **Internal** choice for that scope; no Internal project record is required. See [Activities](../../docs/using/activities.html).

<span id="faq-people-edit-activity"></span>

### Can I change an activity's name or kind?

An Editor or above can select **Edit** on the activity row, change its name or kind, and save. **Project-specific** activities also require a project. If deleted items are still available to restore, changing the kind shows **This change clears N restorable items**. This includes restorable items unrelated to the activity. Select **Cancel** to keep them, or **Save change** to clear them; they cannot be restored or brought back with Undo afterward.

<span id="faq-people-archive-activity"></span>

### What happens when I archive an activity?

An Editor or above can select **Archive** on the activity row and confirm **Archive activity?** Its bookings are hidden from active views with the activity. The archived activity remains available in the archived activities area, where an Editor or above can select **Restore** to bring it and its active bookings back.

<span id="faq-people-restore-activity"></span>

### Why is an activity hidden, and how do I restore it?

An Editor, Admin or Owner can restore activities. If the activity itself was archived, find it under **Archived activities** and select **Restore**. If it is hidden only because its project or client is archived, select **View archived parent**, then find and restore that parent. Restoring a parent reveals children that were not archived separately.

<span id="faq-people-disciplines-order"></span>

### How do I add or change a discipline, and how are they ordered?

An Editor or above can add a discipline on **Disciplines** by entering a name and choosing a preset colour. If **Disciplines** is missing, an Editor or above can turn on **Use disciplines** in **Settings → Company features**. Use the edit control to change a discipline's name or colour; its schedule group position stays the same. The management list is alphabetical, while Schedule follows its saved group order. New disciplines are added after the existing schedule groups and appear once assigned to someone. See [Disciplines](../../docs/using/disciplines.html).

<span id="faq-people-delete-discipline"></span>

### What happens if I delete a discipline?

An Editor or above can confirm **Delete discipline?** to remove the group. Its people are not deleted; they become ungrouped and keep their bookings. Select **Undo** if you removed it by mistake and want to restore the discipline and reconnect people who are still ungrouped.
