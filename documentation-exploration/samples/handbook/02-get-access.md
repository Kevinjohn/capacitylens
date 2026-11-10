---
title: Get access
description: An Owner or Admin invites a teammate, and the teammate accepts and requests company access.
audience: 'Owner, Admin, Editor, Viewer'
screen: 'Team & access'
---

# Get access

An Owner or Admin can invite a teammate from **Team & access**. Choose **Editor** for someone who will plan, or **Viewer** for someone who only needs to read the schedule.

1. Select **Invite someone**, choose the **Role**, enter the teammate's email address and select **Create invite**. CapacityLens emails the invitation to that address. The invitation expires after seven days; **Resend** sends a fresh link and replaces the earlier one.
2. The teammate opens the email link, enters their name and password, then selects **Accept invitation**.
3. They select **Ask for access**. An Owner or Admin opens **Team & access** and, under **Waiting for approval**, selects **Approve**. The teammate selects **Check again** after approval. Every new teammate needs this approval; only an allowed email-domain rule depends on the installation's configuration.

Accepting an invitation creates a sign-in membership; Owner or Admin approval is still required. It does not create a schedule row. To schedule the teammate, add a resource and link the member separately in [Add people](03-add-people.md).

## If access stalls

- **No email arrived:** check the address, then use **Resend** under **Outstanding invites**. If mail delivery is unavailable or CapacityLens reports an email setup problem, ask the installer to restore server email delivery.
- **The link expired:** ask an Owner or Admin to resend the invitation.
- **The address already has a sign-in:** use that account and ask the installer to record the invitation for it. CapacityLens does not merge identities by matching email addresses.
- **Approval is missing:** the teammate should select **Ask for access**. The Owner or Admin checks **Waiting for approval**. If the person was declined, review the decision there.

Never paste an invitation link or other sign-in link into a shared example. For role boundaries, see [Plan next week](01-plan-next-week.md).
