---
title: Philosophy
description: What CapacityLens deliberately does not do, the rules it follows when adding settings, and the standing decisions you notice in daily use.
---

# Philosophy

CapacityLens answers one question for small agencies: who is free next week? This page explains what it leaves out and why. The full list of standing
decisions is in [DECISIONS.md](https://github.com/Kevinjohn/capacitylens/blob/main/DECISIONS.md).

## What it deliberately is not

It does not track tasks, tickets, deadlines, budgets or timesheets, schedule anyone by the hour,
or offer mobile scheduling.

## The option rule

A new setting needs a user who cannot proceed without it. Where possible, CapacityLens works out a
value from what the operator or company has already told it.

## Intentional friction against task tracking

The inline **Add activity** control and the **Task** field in the booking form are company
settings, off by default. Early users treated activities as a task list: one company reached about
300 activities and scheduled hour by hour instead of blocking days on a project. Turn either on in
[Settings](/using/settings#inline-activity-creation).

## Decisions you notice in daily use

<span id="decisions-you-will-notice"></span>

- **Week granularity.** The schedule shows 1, 2, 4, 6 or 8 weeks. Bookings are date ranges with a
  daily amount, not hourly slots.
- **Over capacity means more than available.** Fully booked is not over capacity.
- **Utilisation, not load.** The percentage beside a name covers the weeks you can see. The warning
  for trouble off screen always looks 14 days ahead, whatever the zoom.
- **Working days count.** Ordinary bookings use only a person's working days. Time off is never
  bypassed.
- **Narrowing availability keeps bookings.** If you reduce someone's hours, their bookings stay put
  and show as over capacity.
- **One date format for the company.** The date format is a company setting, not a personal one.
- **The server owns the schedule.** A connection is required. Failed requests stay visible;
  browser persistence never substitutes for a server response and edits are never queued.

Next: [How it compares](/getting-started/how-it-compares) — where another tool fits better.
