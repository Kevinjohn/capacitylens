---
title: Settings
description: Adjust your own display preferences, then find the company-wide switches, offline access and data controls on the same page.
prev: false
next: false
---

# Settings

![Settings showing My display and this-browser preferences](../screenshots/flows/using_settings_1.png)

Open **Settings** near the bottom of the left menu. One scrollable page holds two kinds of choice:

- **My display** changes only your view, in this browser. Everyone can use it.
- **Company setup** and **Scheduling features** change the plan for everyone in the company.
  Editors and above can change them; a Viewer sees them disabled.

**Data and support** holds import and export, offline access and read-only company details.
Each row's question-mark button, **About &lt;section&gt;**, opens a fuller explanation.

[Company settings — for people managing the plan](/admin/company-settings)

## The settings page

| Group               | Who it affects and who can change it                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Company setup       | Everyone. Editors and above change units, working days and date format; only Owners and Admins change Overview access. |
| Scheduling features | Everyone. Editors and above change the **Company features** switches.                                                  |
| My display          | Only you, in this browser.                                                                                             |
| Data and support    | Example data, import and export, offline access and company details. Actions depend on your role.                      |

![Settings with the Company setup group, full-width choices and compact rows](../screenshots/flows/settings_overview.png)

## My display

These preferences are saved in this browser. They don't change a teammate's display or travel
with an export.

![The My display group with Schedule on this device, allocation labels, utilisation figures and appearance preferences](../screenshots/flows/settings_schedule_device.png)

- **Schedule on this device:** **Minimise weekends** narrows Saturday and Sunday so the working
  week gets more room. Weekend work still appears.
- **Allocation labels on this device:** show the client and project name ahead of the activity
  name on bars.
- **Utilisation figures on this device:** choose total, per-discipline and personal figures.
- **Appearance on this device:** **Light**, **Dark** or **Match system**. The moon or sun button
  below **Settings** in the sidebar switches to the opposite of the scheme shown, even when the
  sidebar is collapsed.

## Company setup

These settings affect everyone in the company.

### Allocation units

Choose whether allocations are entered as **Hours**, **Days** or **Blocks**. New companies start
with Days. See [Schedule and change work](/using/schedule-work).

### Company-wide working days

Tick the days your company works. New companies start with the first five days of the week. At
least one day must stay ticked: the last one is disabled until you tick another.

![Company-wide working days in Settings with Monday as the only selected day and an explanation that at least one working day must remain](../screenshots/flows/settings_working_days_guard.png)

Each person works only the days ticked here **and** in their own working pattern. If the company
works Monday to Friday and Bruce Wayne works Monday, Wednesday and Friday, his capacity uses
Monday, Wednesday and Friday.

Other days hold no capacity. Allocations skip them and they don't count towards utilisation. You
can't start new work on them: the hover **+** doesn't appear, and a typed start date, duplicate
or reassignment is rejected. A booking drawn from a working day may still cross them.

The **Ignore working days** option on an allocation makes it use every calendar day in its span
and lets you drag or extend it onto closed days. It never changes where new work may start, and
time off still shows as a conflict. A person's **Start date** and **End date** are a separate limit
it does not bypass; see [Set availability dates](/using/resources#set-availability-dates).

Changing the selection recalculates capacity, utilisation and conflicts straight away. Allocation
dates never move, but work on days that are no longer working days stops counting unless the
allocation ignores working days.

### Date format

Choose how planning dates read for everyone: **9 Sep**, **9th Sep**, **Sep 9** or **Sep 9th**.
It applies to dates and ranges across the app, including Schedule and Time off, and takes effect
without a reload. You can undo it.

- Compact weekday dates on Time off always keep the ordinal: with **9 Sep**, a Wednesday reads
  **Wed 9th Sep**.
- A range crossing a year shows the year at both ends, except in Overview's narrow week headings.
- The date format is not in the JSON from **Import and export**, and an import keeps the
  destination company's format.

Times tied to an event, such as session and invitation expiry, ownership-transfer deadlines and
the offline banner's last-updated time, use your browser's language and time zone instead.

### Overview access

Overview is limited to Owners and Admins by default. An Owner or Admin can choose **Admins**,
**Admins & Editors** or **Everyone**. This controls both the sidebar link and the page itself. See
[Overview](/using/overview).

## Scheduling features

The **Company features** section holds the company-wide switches. **Use disciplines** starts on;
the others start off. Turning a switch off hides the feature without deleting data, and turning
it back on restores it.

Internal projects and activities always show, in neutral grey, so they have no switch.

<!-- Compatibility anchor for existing links to resourcing options. -->

<span id="additional-resourcing-options"></span>

### Disciplines

**Use disciplines** groups people by [discipline](/reference/glossary), such as Design or
Development. Create disciplines and their colours on the **Disciplines** page. See
[Disciplines](/using/disciplines).

### Placeholders and external resources

Two independent switches. **Show placeholders** adds placeholders: unfilled roles or tentative
people for planning future capacity. **Show external resources** adds outside parties, such as a
partner agency or freelancer, for work leaving your team; they carry no capacity. See
[Resources](/using/resources#placeholders).

### Inline activity creation

New activities normally start on the **Activities** page, so the team reuses consistent names.
Turn on **Inline activity creation** to add **Add activity** controls to the allocation form for
everyone who can edit allocations. Turning it off hides only those controls.

### Allocation task field

Turn on **Show task field in schedule** to add an optional one-line **Task** to the allocation
editor. Task text appears above Notes in schedule details and the person's schedule drawer.
Turning it off hides tasks without deleting them.

## Data and support

What you can do here depends on your role. Archived items are restored from their own
Resources, Clients, Projects or Activities page, not from Settings.

### Offline access

Offline access lets you read the schedule on a train or a flaky connection. It is off by default
and turned on per device.

1. Sign in on the device you want to use offline.
2. Open **Settings** and turn on **Make this device available offline** under **Offline access**.

CapacityLens then keeps a copy of the last company you opened, on that device only. If a request
can't reach the server at all, it shows that [snapshot](/reference/glossary) with a banner saying
the data is cached.

- **Read only.** While a snapshot is shown, nobody can create, edit, delete, import or change
  membership, whatever their role. Nothing is queued to apply later.
- **Seven days.** After that the snapshot is gone and you need a connection. A company you
  haven't opened within that time isn't available offline.
- **Refreshes when you load the schedule online.** If the server answers with an error or is
  too slow, you get a retry screen rather than old data.

Turning the setting off, or signing out, clears the snapshot from that device.

::: warning
Don't turn on offline access on a shared or borrowed device. The snapshot is encrypted on disk,
but anyone using the browser while you're signed in can see it in the app.
:::

### Example data

Owners and Admins see **Example data** only while the company has no people, clients, projects or
allocations. **Add example data** adds two people, a client, a project and a few bookings across
this week and next. They are ordinary records; delete them like any others. The request is refused
if the company already holds any of these, including archived or deleted ones.

<!-- Compatibility anchor for existing links to import and export. -->

<span id="everything-else-on-the-page"></span>

### Import and export

**Export JSON** downloads the current company's scheduling records. **Import JSON** replaces those
records after you confirm; in signed-in server deployments, only an Owner can import.

Files must be valid UTF-8 JSON of at most 5 MiB. Invalid or ambiguous JSON is refused before
anything is replaced. Recognised older record values may be repaired or skipped, and the skipped
count is shown afterwards. The company's settings, including date format, and your browser
preferences are not part of the file.

### Company details {#calendar}

A read-only summary of the company name, week start and time zone. Week start sets where each
week begins. Time zone decides which date counts as "today". Both were chosen when the company was
created and cannot be changed.

Owners and Admins can copy build details and a support report from
[Diagnostics](/admin/diagnostics).

![Appearance preferences above Data and support, with Import and export closed](../screenshots/flows/settings_account_disclosures.png)

## Your personal account

Your sign-in, password, company login and **Sign out** are on the **Account** page at the bottom
of the sidebar, not in Settings. See [Account](/using/account).

If a selected company cannot be loaded, a recovery screen hides the previous company's data.
Select **Retry** to load it again, or choose another company.
