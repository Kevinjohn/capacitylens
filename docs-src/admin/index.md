---
title: Get the schedule ready
description: Your first steps as an Admin. Set the working week, add your people and work, make the first booking, then invite the team.
prev: false
next: false
---

<span id="your-route"></span>
<span id="set-up"></span>
<span id="when-you-are-done"></span>
<span id="what-s-next"></span>

# Get the schedule ready

You set the work. Five steps take a new company to a schedule the team can use. You don't need
the Owner or installation guides.

<div class="steps">

1. ![Company setup controls: allocation units set to Days and Monday to Friday ticked as working days](../screenshots/steps/admin_company_setup_controls.png)

   **Set the working week.** Open **Settings**. Under **Company setup**, choose whether work is
   entered in **Hours**, **Days** or **Blocks**, and which days your company works. Days is the
   default. [Every company setting](/admin/company-settings)

2. ![Add resource form: Working days with Full day for Monday to Friday, Not working at the weekend, and Save](../screenshots/steps/admin_add_resource_working_days.png)

   **Add the people you plan for.** Open **Resources** and select **Add resource**. Enter a name,
   set their working days and select **Save**. This [resource](/reference/glossary#resource) now
   has a row on Schedule. They don't need a sign-in to be scheduled.
   [Add people to the schedule](/admin/add-people)

3. ![Add project dialog with Name, Client set to LexCorp, Colour and Save](../screenshots/steps/admin_add_project_dialog.png)

   **Add a client, a project and an activity.** Use **Clients**, **Projects** and **Activities**
   in the left menu, in that order. An [activity](/reference/glossary#activity) is the kind of
   work being booked, such as Wireframes or Build; a **Project-specific** one must pick its
   project. [Prepare clients and work](/admin/prepare-work)

4. ![New allocation for Clark Kent dialog with Project, Activity, Start Date, Days of work, Status and Save](../screenshots/steps/admin_new_allocation_dialog.png)

   **Book the first work.** Open **Schedule** and drag across some days in a person's row. The
   booking form is called **New allocation**. Choose the project and activity, then select
   **Save**. Drag the bar to move it; **Undo** puts it back.
   [Make the first booking](/admin/first-booking)

5. ![Invite someone dialog with Role set to Editor, an email address, Link to Resource set to Diana Prince and Create invite](../screenshots/steps/admin_invite_editor_dialog.png)

   **Invite the team.** Open **Team & access** and select **Invite someone**. Choose a role,
   enter their email and pick their row under **Link to Resource**, so their own work is waiting
   for them. Select **Create invite**. [Invite teammates](/admin/invite-teammates)

</div>

The **Getting started** checklist on Schedule ticks off steps 2 to 4 as you go, in any order.
If the Owner kept the example data, those steps may already be done. The example records are
ordinary: delete them from Resources, Clients and Projects when you no longer need them.

## Who gets which role

| Role   | Can                                                          |
| ------ | ------------------------------------------------------------ |
| Viewer | See the schedule and everyone's work                         |
| Editor | Change the schedule, people, clients, projects and time off  |
| Admin  | Everything an Editor can, plus invite people and set access  |

Most of the team only need **Viewer**. Give **Editor** to whoever books work.

**Are you an Editor?** You can do steps 1 to 4. Inviting people is for an Admin or the Owner.
[Plan work as an Editor](/using/editor) is your day-to-day guide.

<span id="two-records-one-person"></span>

## Give someone a sign-in and a schedule row

Inviting someone lets them sign in. Adding them in **Resources** gives them a row on the
schedule. Most people need both, and **Link to Resource** joins the two. Neither creates the
other.

<span id="moving-from-a-spreadsheet"></span>

## Move from a spreadsheet

There is no importer for spreadsheets or other tools. Add your people first, then clients and
projects, then book only the coming weeks. **Import JSON** (Owner only) moves data between
CapacityLens installations, not from other formats.

<span id="already-up-and-running"></span>

## Go further

- [Ongoing administration](/admin/ongoing-administration): a weekly check, and changes to access,
  working patterns and closures.
- [Diagnostics](/admin/diagnostics): what to copy when you report a problem.
- [Admin FAQ](/admin/faq)
