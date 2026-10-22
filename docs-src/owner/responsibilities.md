---
title: Owner responsibilities
description: The decisions only the Owner can make — who can join, ownership transfer, importing data and deleting the company — and how to make each one.
prev: false
next: false
---

<span id="what-stays-with-the-owner"></span>
<span id="work-your-admin-can-own"></span>
<span id="what-s-next"></span>

# Owner responsibilities

Four decisions stay with you: who can join, transferring ownership, importing a replacement
schedule and deleting the company. Your Admin runs everything else in the company. The installer
handles installation, backups, upgrades and company-login setup.

## Decide who can join

![Owner joining policy with approved-domain entry, Save joining policy and company joining link](../screenshots/flows/owner_joining_policy_current.jpg)

1. Open **Team & access → Who can join**.
2. Choose a policy:
   - **Invitation only**: an addressed invitation is required.
   - **Open registration**: anyone with a verified email can join through the company link.
   - **Approved domains**: verified addresses from the domains you list can join through the link.
   - **Approved domains or invitation**: those domains, plus addressed invitations for people
     outside them.
3. For a domain policy, enter each exact domain on its own line, up to 50 domains. An empty or
   invalid list cannot be saved.
4. Select **Save joining policy**.

Under **Approved domains**, even an invitation is accepted only from a listed domain.

People who join through the policy get **Viewer**. Send an addressed invitation when someone needs
Editor or Admin. Owners and Admins can copy the **Joining link** here; Admins can see the policy but
not change it. A change affects future joins only: it does not change current members or override
**Disable Access**.

If a teammate cannot join, check the policy and the domain spelling. They need a verified address
that meets the policy, or an invitation to their email.
[Join your team](/using/join-your-team) has their steps.

## Transfer ownership

Only the current Owner can transfer ownership. In **Team & access → Company ownership**, select
**Manage ownership**, then choose an active, unrestricted Admin from **Next Owner**. Select
**Transfer ownership** and review the confirmation: the selected Admin becomes Owner and you become
Admin. Confirm this particular transfer with your password or linked Google identity. A recent
sign-in alone is not enough.

The change takes effect immediately. The selected Admin does not separately sign in to accept or
consent. Choose carefully: once confirmed, they hold the Owner role and you no longer do. The member
list and your available company actions refresh to match the new roles.

## Replace the schedule with an import

Import replaces the active company's planning records and supported settings; it does not add to them. Check the
destination and file before you confirm.
In a signed-in installation, confirm the exact file and destination with your password or linked
Google identity. The confirmation cannot be reused for a different import.
[Import and export](/using/settings#import-and-export) has the steps.

## Delete the company

::: warning
Deleting the company permanently removes it and all its data for everyone. There is no undo.
:::

The app does not provide a company chooser or deletion action. Export a copy, then ask the
installer to retire the installation and its data.

To take away one person's access instead, use [Stop access](/admin/invite-teammates#stop-access).

Next: [Owner FAQ](/owner/faq) — common Owner questions.
