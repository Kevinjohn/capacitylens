---
title: What is CapacityLens?
description: A self-hosted, deliberately small tool that answers one question — who's busy, who's free, and when.
---

# What is CapacityLens?

CapacityLens is a helicopter view of your agency's capacity: who's working on what, who's
free, and when. You add your people and your projects, drag out allocations on a
week-by-week calendar, and the answers — [utilisation](/reference/glossary), over-capacity days, who's free next
week — appear without a report to run.

It is self-hosted and open source (AGPL), and it is built for small agencies and studios
running their weekly resourcing meeting, not for large enterprises running portfolio
management.

## What it does

The whole product is one screen: [the schedule](/guide/the-schedule). It shows people
grouped by [discipline](/reference/glossary), with allocation bars, live utilisation
percentages, and time off — holiday, sick, unpaid — all on the same canvas, zoomable from
one to eight weeks. Work hangs off a simple clients → projects → activities shape, with a
built-in "Internal" client for the non-billable stuff. Full undo/redo and filtering by
[person](/reference/glossary), discipline, client, project or
[activity](/reference/glossary) come with it.

Everything past that core view is a switch you flip when your team actually needs it —
[placeholders](/guide/people-and-placeholders) for roles you haven't hired yet, external
resources for studios you hand work to, [offline access](/guide/offline-access) for a
read-only snapshot on the train, [company login](/company-login/) when you outgrow
passwords. Turning a switch off never deletes data; it comes back when you flip it again.

![The Schedule view with people grouped by discipline, allocation bars, utilisation percentages and a holiday block](../screenshots/flows/schedule.jpg)

## Who it's for

CapacityLens is for the person who runs the Monday or Friday resourcing meeting at a
small agency or studio — usually an office manager, a producer, or a founder — and for
the freelancers and contractors on their books, who may never sign in at all. It assumes
a team small enough that one screen can hold everyone, and a planning style measured in
days and weeks, not billable minutes.

## What it deliberately doesn't do

CapacityLens is deliberately **not**:

- a budgeting or billing system
- a timesheet
- an hour-by-hour calendar
- a project-management suite
- a CRM
- a mobile-first app

Those boundaries are on purpose, not missing features. The fastest way to stay small is to
refuse the wrong ones. If you need those tools, CapacityLens is built to sit happily
beside them and stick to the one question it answers best: who's busy, who's free, and
when.

## The scaling ladder

You never migrate to a "bigger edition" of CapacityLens — you flip the next switch when
you get there. The same product runs at every size on this ladder:

| Stage                      | What changes                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Just you, evaluating       | [Try the demo](/getting-started/try-the-demo) — one command, in-memory sample data, nothing installed beyond a copy of the code from GitHub.                      |
| Your team, trusted network | Real persistence, no sign-in wall. Backups on by default.                                                                                                         |
| Real sign-ins              | [Choose how to install CapacityLens](/getting-started/install) with password sign-in: one [Owner](/reference/glossary), invite links, four nested roles enforced on the server. |
| Company-grade identity     | [Company login](/company-login/) (single sign-on) against your identity provider, with optional required multi-factor sign-in.                                    |
| More than one company      | Each company fully isolated — [memberships](/reference/glossary), roles and data checked per company on every request.                                            |

## What's next

[Try the demo](/getting-started/try-the-demo) to see the schedule in your browser in about
two minutes, with no installation.
