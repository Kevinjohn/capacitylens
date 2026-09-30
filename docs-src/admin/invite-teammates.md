---
title: Invite teammates and manage access
description: Create a one-time sign-in invite, set a member role, and connect an existing Resource when needed.
prev: false
next: false
---

<span id="invite-teammates"></span>
<span id="steps"></span>
<span id="what-s-next"></span>

# Invite teammates and manage access

![Team & access: Invite someone](../screenshots/flows/admin_invite_teammates_1.png)

Open Team & access in the left menu and select the primary **Invite someone** button. The
role, email and optional Resource fields open in a centered dialog.

| Role   | Allows                                      |
| ------ | ------------------------------------------- |
| Viewer | Read the schedule                           |
| Editor | Change the schedule and planning data       |
| Admin  | Manage members and company settings as well |

Choose the role and enter the teammate's email in the dialog. An invitation tied to an email can only be accepted by that address.

Leave No Resource linked selected unless their scheduled person already exists.

When SMTP is configured and email sending is available, CapacityLens emails the addressed
invitation. If email is unavailable or sending fails, select **Copy** and send the link privately.
The link remains available either way.

The link is only displayed now. If you lose it, revoke it under Outstanding invites and create a replacement.

## After they join

![Team & access: an accepted member row showing role, email, Resource link and actions](../screenshots/flows/admin_invite_teammates_2.png)

The teammate appears in the members list after accepting. Send them the [day-to-day guide](/using/).

Select the pencil beside their name to change their role, then Save role.

Use Link to Resource to connect their sign-in to an existing scheduled person. Selecting a person saves immediately, and this does not change their access.

## Stop access

Open Member settings beside the member. **Disable Access** stops access to this company and prevents rejoining until an Owner or Admin selects **Enable Access**. The restriction remains visible even after removal. **Archive user** keeps an inactive membership that can later be restored; archiving or removal alone does not prevent a new invitation. Restoring a membership does not clear an explicit Disable Access restriction.

If the person later creates a new sign-in identity with the same address, the restriction follows
that address only when the original and new identities have proven mailbox ownership through
verified company sign-in or a completed mailbox ceremony. An addressed invitation or an older
"email verified" flag alone does not establish that link. Owners and Admins can still manage the
original restriction from the inactive member list.
An established Microsoft sign-in keeps its stable provider identity, but a returning sign-in alone
does not add mailbox proof to an older identity that lacks it.

Remove deletes the membership; the person may return later if the company's joining policy permits it.

## Review who can join

**Who can join** in Team & access shows the current joining policy and every approved
email domain. Only the Owner can change it. Ask them to review the policy if a
teammate cannot join or if registration should be more restricted. A policy join
grants Viewer access; send an addressed invitation when someone needs a different
role. **Approved domains** accepts only the exact listed domains. Under **Approved
domains or invitation**, an addressed invitation can also admit a freelancer from
another domain. **Disable Access** still prevents that person from rejoining.

Owner and Admin can copy the **Joining link** from this section and share it with people who
need access. The link opens this company's joining page; the saved policy still decides who
can join.

[How company joining works](/company-login/#invitations-and-the-first-owner)

[Invitation and access questions](/admin/faq)

[Detailed invitation controls](/getting-started/invite-your-team)
