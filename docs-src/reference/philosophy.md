---
title: Philosophy
description: What CapacityLens deliberately does not do, the rules it follows when adding settings, and the standing decisions you will notice in daily use.
---

# Philosophy

CapacityLens is a small, week-by-week capacity view for small agencies. This page explains
the choices that shape it. The full list of standing decisions is in
[DECISIONS.md](https://github.com/Kevinjohn/capacitylens/blob/main/DECISIONS.md).

## What it deliberately is not

CapacityLens does not track tasks, tickets, deadlines, budgets or timesheets, and it does not
schedule anyone by the hour. It answers one question: where are your people's hours going, and
where is there room? Mobile scheduling is also a non-goal.

## The option rule

A new setting needs a user who cannot proceed without it. Where possible, CapacityLens works
out a value from what the operator or company has already told it, rather than asking again.

## Intentional friction against task tracking

The inline **Add activity** control and the **Task** field in the allocation editor are
company settings that are off by default. Early users treated activities as a task list. One
company reached about 300 activities and scheduled hour by hour, instead of blocking days on a
project. Because CapacityLens is a week-granularity capacity view, the extra steps are
deliberate. See [Settings](/guide/settings#inline-activity-creation) to turn either on.

## Decisions you will notice

- **Week granularity.** The schedule shows 1, 2, 4, 6 or 8 weeks. Bookings are date ranges
  with a daily amount, not hour-by-hour slots.
- **Over capacity means more than available.** A day is over capacity only when the booked
  time is greater than the available time. Fully booked is not over capacity.
- **Utilisation, not load.** The percentage beside a name is calculated over the weeks you can
  see. The forward warning for trouble just off screen always looks 14 days ahead, whatever
  zoom you choose.
- **Working days count.** Ordinary bookings use only a person's working days. Time off is
  never bypassed.
- **Narrowing availability keeps bookings.** If you reduce someone's hours, their existing
  bookings stay where they are and show as over capacity, so nothing moves without you.
- **One date format for the company.** A company reads one convention, so the date format is
  a company setting rather than a personal one.
- **Offline is read-only.** Offline access is opt-in on each device, keeps a snapshot for up to
  seven days and never queues edits.

## What's next

Read [How CapacityLens compares](/getting-started/how-it-compares) to see where other tools
fit better, or [How CapacityLens is tested](/reference/how-it-is-tested).
