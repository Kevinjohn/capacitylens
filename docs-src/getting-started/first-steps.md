---
title: Make your first schedule useful
description: Create the first Owner and company, then add one person, one kind of work and one allocation.
---

# Make your first schedule useful

This guide takes the first [Owner](/reference/glossary) from a new installation to a useful
schedule. Allow about ten minutes after the server is running.

## Prerequisites

- Finish one of the [installation routes](/getting-started/install).
- In password mode, get the one-time Owner setup value from the person who installed CapacityLens.

## Steps

1. **Set up the first Owner.** Open your CapacityLens address. Enter **Your name**, **Work email**,
   **Create a password** and the **Owner setup token** supplied during installation. This creates
   your personal sign-in and gives you the Owner role. You can invite other people later.

   CapacityLens closes public registration as soon as this succeeds. Later teammates join through
   an [invite](/reference/glossary).

   ::: warning
   Do not rely on `admin@admin.admin`. That development-only login is disabled in production.
   The personal sign-in you create here is the first production Owner.
   :::

2. **Create your company.** CapacityLens opens **Set up your company** automatically. Enter the
   company name and check **Week starts on**, **Timezone** and **Language**.

   These three calendar choices are shared by everyone in the company and cannot be changed after
   creation. Pick the convention your team will use. CapacityLens then opens the empty Schedule.

   ![The New company form explains that week start, timezone and language are shared fixed choices](../screenshots/flows/company_setup.jpg)

3. **Understand what CapacityLens plans.** Read **How CapacityLens works** above the page. It
   explains that people are rows, scheduled work spans their days, and clients, projects and
   activities say what the work is for. CapacityLens plans capacity; it does not manage tasks,
   tickets or deadlines.

   This explanation does not block the application. Choose **Got it** when finished. You can reopen
   it at any time from **How CapacityLens works** in the sidebar.

   ![The Schedule and navigation remain available beneath the How CapacityLens works orientation](../screenshots/flows/first_schedule_orientation.jpg)

4. **Choose how to populate the company.** The **Getting started** panel offers two routes.

   - Choose **Import CapacityLens data** only when you have an export that should replace this
     company's data. Opening Import does not count as progress; the imported records must provide
     the outcomes below.
   - Choose **Set up manually** to work through the three outcomes in the app.

5. **Add someone to the schedule.** Follow that link to **Resources**, then add a person whose
   capacity you want to plan. A [person](/reference/glossary) is a schedulable row. A
   [member](/reference/glossary) is someone who can sign in. They are separate: you can schedule a
   freelancer who never signs in, and inviting a teammate does not automatically add them to the
   schedule.

6. **Add work to schedule.** Open **Activities** and add the work you need.

   - For studio work such as planning, select **Internal**. You do not need a client or project.
   - For client work, create the client and project first, then add a project activity.

7. **Schedule the first piece of work.** Return to **Schedule**. Click an empty cell on the person's
   row, or drag across several days. Choose the activity and save the [allocation](/reference/glossary).

   The **Getting started** panel closes when all three outcomes exist: a person, coherent work and
   an allocation connecting them. Imported data follows the same rule.

8. **Use the optional paths when they help.** **Review Settings** is useful when your company works
   differently from the defaults. **Invite your team** opens Team & access for an Owner or Admin.
   **Show me around** gives a five-stop tour without changing pages. None of these is required to
   complete the first schedule.

## What's next

See [The schedule](/guide/the-schedule) for day-to-day planning, or [Invite your
team](/getting-started/invite-your-team) when other people need to sign in.
