---
title: Quick start
description: The whole setup on one page, for the person doing all of it. Install, create the company, add your people and work, and make the first booking.
---

# Quick start

<span id="get-started-quickly"></span>

At a small agency, one person often installs CapacityLens, owns the company and sets the
work. This page is that whole route, from download to a booking on screen. Each step links
to the guide with the detail.

## Install it

You need a server with Node 24 and a hostname pointing at it. On a managed host such as Forge
you never open a terminal.

<div class="steps">

1. **Download** the release archive from the
   [latest release](https://github.com/Kevinjohn/capacitylens/releases/latest) and unpack it.

2. **Pick a folder** for the data. The database file is created there on first start.

3. **Configure** the private environment file from the archive's example. Fill in the public
   address, database path, application key, account secret and one-time setup token. Follow the
   [native installation guide](/self-hosting/install-without-docker) for the exact commands.

4. **Start it** as a background process, with HTTPS in front.

5. **Open the address.**

</div>

[Install CapacityLens](/self-hosting/install) has the exact commands for a managed host and
for your own Linux server.

## Create your company

<div class="steps">

1. ![Owner sign-in setup form with name, email, Create a password and Owner setup token fields and Create my sign-in](../screenshots/steps/owner_setup_sign_in_form.png)

   **Sign in.** Enter your name, email and a password, and paste the setup token from step 3.
   Select **Create my sign-in**.

2. ![Company form with Company name, Week starts on, Timezone, Language, Start with example data ticked and Create company](../screenshots/steps/owner_create_company_form.png)

   **Create the company.** Name it and choose the day your week starts and your time zone. These
   two **cannot be changed later**. Clear **Start with example data** if you'd rather start
   empty. Select **Create company**.

</div>

[Set up your company](/owner/) covers company login and what stays with the Owner.

## Make the schedule yours

<div class="steps">

1. ![Add resource form: Working days with Full day for Monday to Friday, Not working at the weekend, and Save](../screenshots/steps/quick_start_add_resource_working_days.png)

   **Add a person.** First set how work is entered and which days your company works under
   **Settings → Company setup** ([Choose company settings](/admin/company-settings)). Then open
   **Resources**, select **Add resource**, enter their name and working days, and select
   **Save**.

2. ![Add project dialog with Project Watchtower, Client set to Queen Consolidated, and Save](../screenshots/steps/quick_start_add_project_dialog.png)

   **Add a client and a project.** Open **Clients** and select **Add client**. Then open
   **Projects**, select **Add project** and choose that client.

3. ![Add activity dialog with Design, Kind set to Project-specific, Project Watchtower and Save](../screenshots/steps/quick_start_add_activity_dialog.png)

   **Add an activity**, the kind of work being booked. Open **Activities**, select **Add
   activity**, choose **Project-specific** and pick the project.

4. ![New allocation for Bruce Wayne dialog with Project Watchtower, Design, start date, days of work, Status and Save](../screenshots/steps/quick_start_new_allocation_dialog.png)

   <span id="first-booking"></span>**Book the work.** Open **Schedule** and drag across some days
   in the person's row. Choose the project and activity, then select **Save**.

5. ![Bruce Wayne's schedule row with the saved booking bar and his utilisation](../screenshots/steps/quick_start_first_booking.png)

   **Move it.** Drag the bar to another day or another person. **Undo** puts it back.

</div>

That's a working schedule.

<span id="the-getting-started-checklist"></span>

## Follow the Getting started checklist

<span id="make-your-first-schedule-useful"></span>

![Getting started progress at 0/5 with the five setup milestones on Schedule](../screenshots/flows/getting_started_five_steps.png)

**Getting started** on Schedule ticks off these five steps as you go, in any order, and stays
until an Owner or Admin dismisses it. **Show me around** starts a short tour.

Steps complete from the company's records, including imported ones. Internal work doesn't count
towards the client or project steps. Editors can open and close the checklist; Viewers don't see
it. An Owner or Admin can dismiss it for everyone, and is asked to confirm if steps remain.

## Bring in the team

Open **Team & access**, select **Invite someone**, choose a role and enter their email. Most
people need **Viewer**; give **Editor** to anyone who books work.
[Get the schedule ready](/admin/) covers roles, settings and linking each invitation to the
right row on the schedule.

Before you rely on it, [check your backups](/self-hosting/backups-and-restore).
