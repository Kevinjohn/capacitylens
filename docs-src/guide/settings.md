---
title: Settings
description: The company-wide switches that control what's visible on the schedule, plus the ones that are just yours.
---

# Settings

Settings is one scrollable page of plain-language switches — no tabs, no separate admin
console. Most settings apply to the whole company; a few apply only to your own device.
This page covers the two switches worth understanding early, plus a map of everything
else. Each section has a question-mark button labelled **About &lt;section&gt;**: hover it
for that short label, or activate it to open the fuller explanation without keeping that
text on the page.

![The top of Settings with Scheduling, Global working days, Disciplines and Engagement grouping sections, each with an About button](../screenshots/flows/settings_overview.jpg)

## Global working days

**Global working days** is the company's shared outer boundary for starting work. New companies
select the first five days of their configured week. You can select any combination of the seven
checkboxes; their order follows the week start chosen when the company was created.

The schedule combines this selection with each person's own working pattern and time off. On a
blocked start date, the lane does not show the hover **+**, and clicking or beginning a draw does
nothing. A draw that begins on an allowed date may still cross blocked dates. This setting controls
where creation can start; it does not recalculate existing capacity or utilisation.

## Internal work visibility

Two switches under **Internal work**, both on by default, control whether internal and
non-billable work shows up on the schedule at all:

- **Show internal projects**
- **Show internal activities**

Turning either off hides the matching bars from the schedule — useful if some of your
team only wants to see client work. It doesn't change capacity: hidden internal work
still counts toward a person's [utilisation](/reference/glossary), so someone who's
fully booked with internal work still shows as fully booked. Nothing is deleted, and the
bars come back the moment you turn the switch back on.

## Inline activity creation

When you're booking an allocation and the [activity](/reference/glossary) you need
doesn't exist yet, the allocation form normally lets you add it on the spot without
leaving the form. That
convenience is controlled by **Inline activity creation** under **Activity creation**,
on by default. Turning it off means everyone has to create new activities from the
**Activities** page first, then pick from the existing list when they allocate — useful
if you'd rather keep activity names tidy and reviewed.

## Everything else on the page

The rest of Settings, roughly top to bottom:

| Section                       | What it controls                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling                    | Whether allocations are entered as Hours, Days or Blocks — see [Projects and allocations](/guide/projects-and-allocations).                                                                                                                                                                                                            |
| Global working days           | The seven company weekdays on which a schedule click or draw may start work. Personal patterns and time off can restrict a person further.                                                                                                                                                                                              |
| Disciplines                   | Whether people are grouped by [discipline](/reference/glossary) (Design, Development, and so on) across the app. On by default. Disciplines themselves — their names and colours — are created on the standalone **Disciplines** page in the main navigation, not here; see [People and placeholders](/guide/people-and-placeholders). |
| Engagement grouping           | Whether Resources separates Studio and Supplementary people. On the schedule, those bands hold people outside a discipline and become the main groups when disciplines are off. On by default; favourites stay first inside each engagement group. See [People and placeholders](/guide/people-and-placeholders).                                                                                         |
| Schedule (this device)        | Minimise weekends, snap to week start, and compact view — your own display preferences, not shared with teammates.                                                                                                                                                                                                                     |
| Internal work colours         | Whether internal work uses grey bars (default) or the same colour palette as everything else.                                                                                                                                                                                                                                          |
| Placeholders                  | Whether unfilled [placeholder](/reference/glossary) slots are available. Off by default. See [People and placeholders](/guide/people-and-placeholders).                                                                                                                                                                                |
| External                      | Whether [external parties](/reference/glossary) — outside companies you hand work to but don't manage, like print shops — are available. Off by default. See [People and placeholders](/guide/people-and-placeholders).                                                                                                                |
| Allocation bars (this device) | Whether bars show the client name and project name ahead of the activity name.                                                                                                                                                                                                                                                         |
| Utilisation                   | Which utilisation figures appear on the schedule: total, per-discipline and personal.                                                                                                                                                                                                                                                  |
| Appearance (this device)      | Light, dark, or match your system theme.                                                                                                                                                                                                                                                                                               |
| Offline access                | Keep the last company you opened available on this device for seven days, read only. See [Offline access](/guide/offline-access).                                                                                                                                                                                                      |
| Device data                   | Clear everything CapacityLens has stored on this device.                                                                                                                                                                                                                                                                               |
| Account                       | Your sign-in email and a sign-out button.                                                                                                                                                                                                                                                                                              |
| Security                      | Change your password and review your active sign-in sessions, in password mode.                                                                                                                                                                                                                                                        |
| Archived & deleted            | A closed-by-default disclosure for restoring something you archived or permanently deleting it. See [People and placeholders](/guide/people-and-placeholders).                                                                                                                                                                         |
| Import & export               | A closed-by-default disclosure for downloading this company's data as JSON or replacing it from an earlier export. Importing asks you to confirm first.                                                                                                                                                                                |
| Account Options Selected at Creation | A compact, read-only summary of the company name, week start, time zone and language. These values were selected when the company was created.                                                                                                                                                                                   |

**Device data**, **Archived & deleted** and **Import & export** are independent
disclosures and start closed. Opening one does not close another. Destructive actions
still explain their consequences in the confirmation dialog.

![The bottom of Settings with Account and Security details, closed Device data, Archived and Import disclosures, and the account options summary](../screenshots/flows/settings_account_disclosures.jpg)

::: tip
Sections marked "this device" only affect your own browser. Everything else is shared
by the whole company and needs Editor access or above to change.
:::

## What's next

[People and placeholders](/guide/people-and-placeholders) and
[Projects and allocations](/guide/projects-and-allocations) cover the two switches
above in more detail.
