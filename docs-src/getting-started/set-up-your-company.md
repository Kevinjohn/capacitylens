---
title: Set up your company as Owner
description: Take a fresh CapacityLens installation from the first Owner account to an administered team and a ready-to-use schedule.
---

# Set up your company as Owner

This is the handover path for the first [Owner](/reference/glossary) of a new installation.
It connects the existing setup guides in the order you need them: claim the Owner account,
prepare the schedule, invite an Admin, compare members with scheduled people, and transfer
ownership if somebody else should hold it.

## Prerequisites

- Complete one of the [technical installation routes](/getting-started/install).
- For password mode, keep the one-time Owner setup token private until the first account is claimed.
- For company login, add the first Owner's email to
  [`SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS`](/self-hosting/configuration#company-login).

## 1. Claim the Owner account and create the company

In password mode, follow [Make your first schedule useful](/getting-started/first-steps). **Set up
the first Owner** creates a personal sign-in for the installation and explains that the person
becomes Owner; the setup token authorises that claim and does not create the company. With company
login, choose the configured provider with the verified bootstrap-listed email instead. That route
creates or signs in the first Owner through the provider and does not use a CapacityLens password or
the password-mode setup token. Either route opens **Set up your company** automatically when no
company exists.

Choose the company name, week start, timezone and language carefully. The company name can be
changed later. The three calendar choices are shared by everyone in the company and cannot be
changed after creation: week start controls the order of schedule days, timezone sets the
company-wide **Today** and date-based scheduling boundary, and language controls the shared display
language. The first-company form has no Cancel action because creating the company is the only
available next step. Once the Owner and company exist, everybody else joins through an invitation.

## 2. Prepare the schedule

Use the **Getting started** panel on the Schedule. Import an existing CapacityLens export, or set
up manually and complete three outcomes: add someone to schedule, add work, then allocate that work.
Internal work needs no client or project. Review Settings only when the defaults need changing.

People on the schedule are not sign-in accounts. Add everyone whose capacity you plan, including
people who will never sign in, by following [People and placeholders](/guide/people-and-placeholders).

## 3. Invite an Admin

Open **Team & access** and [invite a trusted teammate](/getting-started/invite-your-team#create-an-invite)
with the **Admin** role. An Admin can manage invitations, members and ordinary company settings,
but cannot manage the Owner or perform Owner-only actions. The invitation page explains how the
recipient creates or reuses a sign-in and accepts the role.

Once the invitation is accepted, agree who will maintain [Settings](/guide/settings), the people
list and routine access changes. Use [Roles and permissions](/getting-started/roles-and-permissions)
when deciding whether later invitees should be Viewers, Editors or Admins.

## 4. Compare members with scheduled people

Review **Team & access** beside **Resources** after the first invitations are accepted.

- **Team & access** lists members: people who can sign in and their permission role.
- **Resources** lists people whose time can be scheduled, whether or not they can sign in.

There is no account-to-resource link to create or maintain. Use the two lists to check that every
teammate who needs access has the right membership, and that everyone whose capacity you plan has
a resource with the right working pattern. Matching names can make that comparison easier, but
the records remain independent. Do not invite freelancers or placeholders merely because they
appear on the schedule.

If you need confirmation that invited members have reached the company, the Owner can turn on
**Record member sign-ins** in **Team & access**. It records only **Yes** or **Not yet** and is off
by default. See [Managing someone who already joined](/getting-started/invite-your-team#managing-someone-who-already-joined).

## 5. Hand over routine administration

Ask an Admin to check **Team & access**, [Settings](/guide/settings), and the company data with
you. They can handle day-to-day membership and setup without receiving the Owner's destructive
and private-data powers. Keep one clear Owner even when several people administer the company.

## 6. Transfer ownership when responsibility changes

If the intended long-term Owner is now an active Admin, follow [Hand the company to someone
else](/getting-started/roles-and-permissions#hand-the-company-to-someone-else). The current Owner
nominates that Admin, the Admin agrees, and the same Owner confirms. Nothing changes until all
three steps are complete.

Ownership cannot be granted in an invitation or an ordinary role change. After the transfer, the
former Owner becomes an Admin, so routine access continues without creating a second Owner.
If a damaged stored request prevents the normal flow, the host operator should use the guarded
[ownership-transfer recovery runbook](/self-hosting/ownership-transfer-recovery).

## What's next

[The schedule](/guide/the-schedule) starts the day-to-day guide. For operating the server rather
than the company, continue with [Backups and restore](/self-hosting/backups-and-restore) and
[Monitoring and health checks](/self-hosting/monitoring).
