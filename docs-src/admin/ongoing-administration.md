---
title: Handle ongoing administration
description: Keep access, working patterns and company closures up to date as your team and work change.
prev: false
next: false
---

<span id="regular-tasks"></span>
<span id="what-s-next"></span>

# Handle ongoing administration

Keep access, working patterns and closures up to date as people and work change.

## Change access

![Change member role dialog explaining Editor permissions before saving](../screenshots/flows/admin_change_member_role.jpg)

Open **Team & access**. Review **Outstanding invites** and revoke any that are no longer needed.
Use the pencil to change a member's role and the link icon to change their schedule row.

![Team & access: Member actions dialog](../screenshots/flows/admin_member_actions.jpg)

**More actions** holds **Disable Access**, **Enable Access**, **Archive user**, **Restore
membership** and **Remove**. Disable Access blocks entry to the company even after removal, until an
Owner or Admin clears it. Archive keeps the record and can be restored. Removal ends the membership
in this company only. [Stop access](/admin/invite-teammates#stop-access) covers each one.

## Change working patterns

1. Open **Resources** and edit the person.
2. Update **Working days**, or **Start date** and **End date**.
3. Select **Save**.

A person's working days, together with the company's, set their capacity. Changing them
recalculates Utilisation and conflicts; it does not move bookings. Availability dates are inclusive.
Outside them capacity is zero, but existing bookings stay visible. Check
[Set availability dates](/using/resources#set-availability-dates) before narrowing someone's
availability.

Archive a person when they leave active scheduling. Archived people are listed at the bottom of
Resources.

## Add a company closure

![Time off: Company closures with Add closure form](../screenshots/flows/admin_ongoing_administration_2.png)

1. Open **Time off**.
2. Under **Company closures**, select **Add closure**.
3. Enter the name and the **Start** and **End** dates (inclusive), and select **Save**.

A closure sets capacity to zero for every person and placeholder on those dates, including people
added later. It does not cover external parties or remove bookings; overlapping work shows as a
conflict. Shortening or deleting the closure restores capacity without moving bookings.

For one person's absence, [record time off](/using/time-off#record-time-off).

## Ask the Owner or operator

<span id="owner-and-operator-handoffs"></span>

Ask the Owner to transfer ownership, delete the company or import scheduling data. Ask the service
operator about backups, upgrades and company-login setup. When something goes wrong, copy a report
from [Diagnostics](/admin/diagnostics).

Next: [Admin FAQ](/admin/faq) — or [Company settings](/admin/company-settings) to change the shared
rules.
