---
title: Owner FAQ
description: Answers to common questions about company setup, handing over to an Admin, and ownership.
prev: false
next: false
---

<span id="what-s-next"></span>
<span id="do-i-have-to-set-up-the-schedule-myself"></span>
<span id="can-i-have-more-than-one-owner"></span>
<span id="can-an-admin-transfer-ownership"></span>
<span id="why-do-some-actions-ask-me-to-confirm-my-sign-in"></span>
<span id="what-does-the-technical-installer-need-from-me"></span>

# Owner FAQ

## Can I stop after I appoint an Admin?

Yes. Once their row in **Team & access** shows **Admin**, send them
[Get the schedule ready](/admin/). If you run the schedule yourself, follow that guide instead.

## Why is the Admin invitation still pending?

They have not accepted it yet. Check the email was sent, or send the link yourself with **Copy**.
If the link is lost, revoke it under **Outstanding invites** and create a new one.

## Does an Admin invitation transfer ownership?

No. Ownership changes only through **Manage ownership**, after the nominee agrees and you confirm.
There is only ever one Owner; give other managers the Admin role.
[Transfer ownership](/owner/responsibilities#transfer-ownership)

## Why is there no Admin to choose as Next Owner?

Only an active Admin can be nominated. Invite them as Admin first, then return once they accept.

## What happens if an ownership transfer ends?

Nothing changes: you remain the Owner. **Manage ownership** shows whether it was declined,
cancelled, replaced, expired after seven days, or ended because a participant's membership changed.

<span id="can-i-change-the-week-start-timezone-or-language"></span>

## Can I change the week start, time zone or language?

No. Week start and time zone are fixed when the company is created, and English is the only
language.

## Who can change the joining policy?

Only you. Admins can see it and copy the joining link. People who join through the policy get
Viewer; send an addressed invitation for any other role.
[Decide who can join](/owner/responsibilities#decide-who-can-join)

## Why can't I find Delete company?

**Delete** is in the company chooser. **Switch company** opens it, and appears only when you can
access two or more companies. A standard installation holds one company: export a copy, then ask
the installer to retire the installation and its data.
[Delete the company](/owner/responsibilities#delete-the-company)

## Why am I asked to confirm my sign-in?

Transferring ownership, importing and deleting the company need a recent sign-in.

## What does it cost?

Nothing. CapacityLens is free and open source (AGPL-3.0), with no paid tier and no hosted version.
The only cost is the server it runs on ([server size](/self-hosting/install#server-size)).

## Is our client information private?

Your data stays on your own server. Your installer, who runs that server, can reach it. To hide a
sensitive client or project name from everyone except you, give it a
[code name](/using/projects#hide-a-client-or-project-name). [Privacy](/security/privacy) covers
what is stored and where.

## How do I see who's overloaded?

On **Schedule**, a day shows red when someone is booked for more than they can do.
[Overview](/using/overview) shows each person's free capacity week by week.

## How do we get our data out?

Open **Settings → Data and support → Import and export** and select **Export JSON**. The file holds
the company's scheduling records, such as people, clients, projects, bookings and time off, and can
be imported into another CapacityLens installation. It does not include members or settings. There
is no CSV or spreadsheet export.

## My Admin is leaving. What do I do?

Invite the new Admin first. Then, in **Team & access**, open the departing Admin's **More actions**
and select **Disable Access**: they can no longer open the company, and their record stays. Their
row on the schedule and their bookings are not affected.
[Stop access](/admin/invite-teammates#stop-access) explains the other options.

## What if I leave?

Hand the company to an Admin with a [transfer of ownership](/owner/responsibilities#transfer-ownership).
