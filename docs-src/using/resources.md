---
title: Resources
description: Recognise the people, placeholders and external parties available for scheduling, then add, edit, link and archive them.
prev: false
next: false
---

# Resources

![Resources showing names, roles, disciplines and placeholders](../screenshots/flows/using_resources_1.png)

**Resources** lists everyone who can be booked on [the schedule](/using/read-the-schedule): your
people, with their role and discipline where supplied, plus any placeholders and external
parties. To see someone's work, open their [work list on Schedule](/using/read-the-schedule#your-work-list).

[Add scheduled people](/admin/add-people)

## People and placeholders

A person on Resources has no sign-in, and inviting a [member](/reference/glossary) doesn't put
them on the schedule. Most people need both, joined by a link. See
[Roles and permissions](/getting-started/roles-and-permissions).

## Link a person to a member

Open **Team & access** and select the link icon in the member's row. Choose an available person
Resource; the choice saves immediately. Choose another Resource to change it, or select **Remove
link to resource**. Each member links to one person and each person to one member. A link
doesn't grant access or create schedule data.

![Resource link dialog for a linked member, with Remove link to resource available](../screenshots/flows/admin_resource_link_remove.jpg)

Only active members and active people can be newly linked. A link to an inactive member or person
can still be removed. To move a person's link to another member, remove the old link first.

To invite someone and link them at once, use **Invite someone** and its **Link to Resource**
selector. See [Invite teammates and manage access](/admin/invite-teammates).

## Add a person

Open **Resources**, select **Add resource**, fill in the form and save.

![The Add resource form with optional Start date and End date fields separated from a seven-day working-pattern grid](../screenshots/flows/resource_form.png)

- **Name:** required.
- **Role:** optional free text, for example "Senior Designer".
- **Discipline:** the group they appear under on the schedule, which also sets their colour.
  Shown only while the company uses [disciplines](/reference/glossary), the default. Create
  disciplines on the [Disciplines](/using/disciplines) page.
- **Engagement:** **Studio** for the core team or **Supplementary** for additional capacity. It
  only changes which section they appear in, not their discipline, role, working days or
  utilisation.
- **Working days:** **Full day** (eight hours), **Half day** (four) or **Not working** for each day
  from Monday to Sunday.

![The Add resource form with the always-visible Engagement choices and Supplementary selected](../screenshots/flows/resource_engagement_choice.png)

Working days drive utilisation: CapacityLens compares this pattern with the person's bookings to
decide whether they're over capacity. Only days in both this pattern and the
[company-wide working days](/using/settings#company-wide-working-days) count. Get it wrong and the
[overwork indicators](/using/read-the-schedule#reading-overwork) are wrong for that person.

The new row appears on the schedule straight away. If the server rejects the change, the form
stays open with the error so you can correct it.

## Edit a person

Select the edit icon in the person's row, change any field and save. If someone goes part-time,
set the relevant days to **Half day** or **Not working**. Existing allocations aren't rewritten,
but utilisation reflects the new pattern from then on.

![The Edit resource form with Wednesday set to Half day in a person's seven-row working pattern](../screenshots/flows/resource_half_day.png)

Profile pictures come from each person's own sign-in, not this form; initials are the fallback.
Owners and Admins connect a sign-in to a person from **Team & access**.

## Set availability dates

Studio and Supplementary people can have an optional **Start date** (first day they can work) and
**End date** (last day). Both are inclusive; leave either blank for no limit, or use the same date
in both for one day. An invalid date, or a start after the end, is rejected and the form stays open.

Capacity is zero outside the range. Existing bookings there stay visible and still count, so
narrowing the range doesn't delete or move anything. You can still edit the person's details, but
creating, moving, resizing, reassigning or repeating work onto a working day outside the range is
blocked. **Ignore working days** doesn't bypass these dates: extend the range first.

Placeholders and external parties don't have these fields.

## Find people quickly

Once anyone is **Supplementary**, Resources splits people into **Studio** and **Supplementary**
sections, followed by Placeholders and External. A team with only Studio people sees one People
list. Archived people and external parties don't trigger the split. Each section is alphabetical.

![The Resources page with Barry Allen, Bruce Wayne and Clark Kent in Studio, and Diana Prince in Supplementary](../screenshots/flows/resources_engagement_groups.jpg)

Select the star in a person's or external party's row to make them a company favourite. The star
fills yellow and the row moves to the top of its section. The schedule keeps Studio before
Supplementary within each discipline, favourites first. Favourites are shared, so everyone sees
the same order. Placeholders can't be favourited.

## Placeholders

A [placeholder](/reference/glossary) holds work for a role you haven't filled or assigned yet,
such as "a Design Lead". Placeholders are off by default; Editors and above turn them on in
[Settings → Placeholders and external resources](/using/settings#placeholders-and-external-resources).

Once on, Resources shows a **Placeholders** section with **Add placeholder**. The name is optional
(it shows by its role instead), but a placeholder must be bound to a project. Placeholders carry a
"placeholder" badge and hatched styling on the schedule. They have no personal working pattern, so
they follow the company's working days.

## External parties

An [external party](/reference/glossary) is an outside company you hand work to, such as a print
shop or an overflow studio. They appear on the schedule so you can see the handoff, but carry no
hours and never count towards capacity or utilisation. Their bookings use their literal start and
end dates.

Use an external party when the work is leaving your team. Use a placeholder when someone on your
own team will do it, even if you haven't named them yet.

External parties are off by default; Editors and above turn them on in
[Settings → Placeholders and external resources](/using/settings#placeholders-and-external-resources).
Then, under **External**, select **Add external party**, enter the **Company** and an optional
**Descriptor** such as "Print", and save.

![The Resources page with separate Studio and Supplementary sections and the External section listing Kord Industries as a partner studio](../screenshots/flows/resources_external.jpg)

Turning placeholders or external parties off hides their sections, rows and assignee entries
without deleting anything. Turn the switch back on to restore them.

## Archive someone who leaves

Select the delete icon in the person's row and confirm **Archive resource?** Archiving hides them
from the schedule and the assignee picker but keeps their past allocations.

Owners and Admins see archived resources at the bottom of Resources, grouped as **Archived
Studio**, **Archived Supplementary**, **Archived External** and **Archived placeholders**. Restore
someone there, or delete the archived record to remove it from those lists. Permanent deletion is
not available in the app.

Next: [schedule work](/using/schedule-work) or record [time off](/using/time-off).
