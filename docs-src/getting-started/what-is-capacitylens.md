---
title: What is CapacityLens?
description: A shared, week-by-week view of who is busy, who has room and who is about to be overloaded, for small agencies.
---

# What is CapacityLens?

![The Schedule view with people grouped by discipline, allocation bars, utilisation percentages and a holiday block](../screenshots/flows/schedule.jpg)

CapacityLens is a shared schedule for a small agency. It answers one question: who is free
next week?

## Why it exists

At most small agencies, that answer lives in one person's head or a spreadsheet only they
understand. Work gets promised to people who are already full. Spare time nobody noticed goes
unsold. Someone finds out about a new project the week before their holiday.

CapacityLens puts the whole team on one screen that everyone can read, so you can see trouble
coming and move work around before it lands.

## What you get

- **The weeks ahead at a glance.** Show 1, 2, 4, 6 or 8 weeks, filtered by client, project or
  activity.
- **Early warning.** Days when someone has more work than time show in red, and a separate
  warning looks two weeks ahead for problems not yet on screen.
- **How full everyone is.** A [utilisation](/reference/glossary#utilisation) percentage beside
  each name, for the weeks on screen.
- **Time off in the same picture.** Holidays and company closures sit beside the work, so they
  stop being a surprise.
- **Work you haven't won yet.** Tentative bookings, [placeholders](/reference/glossary#placeholder)
  for roles you haven't filled, and external parties who don't count against your team's capacity.
- **Your own server.** Your data stays in one file on a server you control.

It is free and open source (AGPL-3.0). There is no paid tier and no hosted version: you run it on
your own server, and the only cost is that server ([server size](/self-hosting/install#server-size)).

## What it leaves out

CapacityLens does not track tasks, tickets, deadlines, budgets or timesheets, and it doesn't
schedule anyone by the hour. If you need those, use a tool built for them;
CapacityLens is the view you check first.
[Philosophy](/reference/philosophy) explains why.

There is no importer from spreadsheets or other tools. You enter your people, clients and projects
in the app; the JSON import only moves data between CapacityLens installations.
[Moving from a spreadsheet](/admin/#moving-from-a-spreadsheet) suggests an order.

## Who it's for

Agency owners, studio and operations leads, and project managers: the people asked "can we
take this on?" who need an honest answer the whole team can see. Everyone else on the team uses
it to see their own week.

## Before you adopt

- **Status.** CapacityLens is alpha software with a single maintainer. Beta will mean the upgrade
  path and the settings are stable.
- **Leaving.** Your data is one SQLite database file on your server, and **Export JSON** in
  Settings downloads the company's scheduling records. The AGPL lets anyone continue the code.
- **Outside services.** None is needed to run it. Email, sign-in through Google, Microsoft or
  GitHub, and the breached-password check (on by default) are the only ones it can use.
- **Support.** Community help on a best-effort basis, with no guaranteed response time.
  [Get help](/open-source#get-help) explains where to ask.

<span id="the-scaling-ladder"></span>
<span id="get-started"></span>

Next: [Choose your guide](/#which-one-are-you) — start with your role.
