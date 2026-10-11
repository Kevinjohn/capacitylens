---
title: Invite teammates
description: Invite teammates with a one-time link, choose their role, link them to their schedule row, and change or stop their access later.
prev: false
next: false
---

<span id="invite-teammates"></span>
<span id="steps"></span>
<span id="what-s-next"></span>

# Invite teammates

Invite people, choose what they can do, and later change or stop their access. Only an Owner or
Admin can do this. An Editor or Viewer who opens **Team & access** sees their own role instead of
**Invite someone**.

## Send an invitation

![Team & access: Invite someone](../screenshots/flows/admin_invite_editor_form.jpg)

1. Open **Team & access** and select **Invite someone**.
2. Choose the **Role**. The dialog spells out what the role can and can't do, and **See full
   capabilities** lists everything. [Roles and permissions](/getting-started/roles-and-permissions)
   compares the roles.
3. Enter the teammate's email. Only that address can accept the invitation.
4. If the person already has a row on the schedule, choose it under **Link to Resource**. Otherwise
   leave **No Resource linked**.
5. Select **Create invite**. If email is set up, CapacityLens sends the invitation. If it isn't, or
   sending fails, select **Copy** and send the link privately.

![Invite someone dialog with the optional Link to Resource selection](../screenshots/flows/invitation_created.png)

The link is shown only in this dialog. CapacityLens keeps only a hash of it, so nobody can retrieve
it later. If it is lost, revoke the invitation under **Outstanding invites** and create a new one; the
old link stops working at once. If you close the dialog before the invitation is created, a
notice says the link was not shown.

## If the linked person is no longer available

The **Link to Resource** choice is a proposal: it does not reserve the person, and the recipient
cannot see it. If that person is no longer available when the invitation is accepted, the member still
joins and their row shows **Resource link needs attention**. Select **Choose another person** or
**Dismiss**.

<span id="what-the-invitee-sees"></span>

## Check what the invitee sees

![Invitation preview showing company, proposed role, expiry and existing-account sign-in](../screenshots/flows/join_invitation_preview.jpg)

The link opens a preview of your company name, the proposed role, what it allows and when the link
expires, in the invitee's local time. Opening it does not change
[membership](/reference/glossary#member). They then:

- sign in on the **Sign in** tab with their existing password, then select **Accept invite**;
- choose **Create account**, then **Create account and accept**, which creates the sign-in and
  accepts in one step; or
- choose a company login provider, return to the invitation and select **Accept invite**.

The preview shows only the start of the invited address, such as `selina.kyle@…`. They must enter
the full address. Entering a different one cannot change who the invitation is for. When they
accept, they land on your schedule. If the link has expired, they ask the sender for a new one.

## Revoke an invitation

<span id="outstanding-invites"></span>
<span id="pending-invites"></span>

Invitations not yet accepted are listed under **Outstanding invites**, above your members. A proposed
Resource stays marked pending until the invitation is accepted. Select **Revoke** to cancel an
invitation.

## Change a member's role or schedule row

<span id="managing-someone-who-already-joined"></span>

![Members table with role, email, Resource link and row actions](../screenshots/flows/team_access_members.png)

Send new members [See your work](/using/). Members are listed by role, Owner first. On each
row:

- The edit icon changes their role. The dialog explains the consequences before you **Save role**.
- The **link icon** opens **Link to Resource**. Choosing a person saves immediately and does not
  change their access. **Remove link to resource** unlinks them immediately.
  [Link a person to a member](/using/resources#link-a-person-to-a-member)
- **More actions** offers the rest: reset their password, **Revoke sessions**, **Disable Access**,
  **Archive user** or **Remove**.

![Resource link dialog for a linked member, with Remove link to resource available](../screenshots/flows/admin_resource_link_remove.jpg)

## Stop access

All three are in **More actions**. None affects the person's other company memberships.

- **Disable Access** stops them opening the company immediately, including through an existing
  session or a later invitation. It stays in force even after removal, until an Owner or Admin
  selects **Enable Access**, which is also available for people under **No longer active**.
- **Archive user** stops their access but keeps an inactive record. **Restore membership**
  reactivates it, but does not clear Disable Access.
- **Remove** ends that membership; it doesn't disable the person's sign-in. They may return later
  if the joining policy allows it.

Archiving or removing does not block a new invitation; a returning person gets the invitation's
role. After **Enable Access**, an active member keeps their role, but an archived or removed person
still needs restoring or a new invitation.

<span id="if-they-come-back-with-a-new-sign-in"></span>

If they return with a new sign-in, check **No longer active**: [Company login](/company-login/#if-someone-returns-with-a-new-sign-in)
explains when the restriction follows them.

## Review who can join

![Admin view of Who can join with the current policy and joining link, without Owner-only policy editing](../screenshots/flows/admin_joining_policy_readonly.jpg)

**Team & access → Who can join** shows the joining policy and approved domains. Only the Owner can
change it; ask them if a teammate cannot join or registration should be tighter. Copy the
**Joining link** to share it; the policy still decides who gets in. People who join through the
policy get Viewer, so send an addressed invitation for any other role.
[Decide who can join](/owner/responsibilities#decide-who-can-join) explains each policy.

A fresh install allows one company. The installer can allow more with `CAPACITYLENS_MULTI_ACCOUNT`
([Configuration](/self-hosting/configuration)).

Next: [Admin FAQ](/admin/faq) — fix a stuck invitation.
