---
title: Sign-in and access
description: Sign in with a password, accept an invitation, wait for approval and join your company.
---

# Sign-in and access

Everyone signs in with an email address and password. The in-memory demo does not need a real
sign-in; every persisted server requires a signed-in, approved company member. CapacityLens has no
Google, Microsoft or other company sign-in.

## Join through an invitation

An Owner or Admin invites you from **Team & access**, and CapacityLens emails you the link. The link
works once and expires after seven days. Ask for a new invitation if yours has expired; the Owner or
Admin can also select **Resend**, which replaces the earlier link.

1. Open the link. The page shows the company and the role you were invited with.
2. Enter your **Name** and choose a **Password**, then select **Accept invitation**. Your address is
   the one the invitation was sent to.
3. Select **Ask for access**. An Owner or Admin approves new people in **Team & access** under
   **Waiting for approval**. Select **Check again** once they tell you it's done, and the company
   opens with the role on your invitation. Nobody joins as Owner.

An invitation creates a new sign-in. If your address already has one, sign in instead and ask the
installer to record the invitation for that account with the `account-kit:admission:grant-invitation`
operator command. CapacityLens never merges two sign-ins because their addresses match.

An invitation does not put you on the schedule. An Owner or Admin links your membership to a
scheduled person after you join.

## When you see a limited screen

A signed-in person who cannot open the company yet sees only the next step:

- **Confirm your email address.** Select **Email me a confirmation link**, then open the link and
  choose your password.
- **Waiting for access.** Select **Ask for access** if you haven't, then wait for an Owner or Admin.
- **Access refused.** An Owner or Admin declined or withdrew your access. Ask them if this is a
  mistake.
- **Join company.** You are approved but not yet a member, for example after the installer recorded
  an invitation for an existing sign-in. Select **Join company** to join with the invited role, or
  as a Viewer when none was recorded.

Approval, refusal and withdrawal take effect on your next request.

## Passwords and sessions

<span id="sessions-and-staying-signed-in"></span>

You stay signed in until fourteen days pass without activity, or until you sign out. Changing your
password in **Account**, or resetting it, signs you out everywhere, including the
browser you used. Sign in again with the new password.

Select **Forgot password?** on the sign-in page to receive a reset link by email. Owners and Admins
cannot reset another member's password or end their sessions from the product; the installer's
operator commands cover a locked-out person.

Transferring ownership, importing company data and anonymising every person in the company ask for
your password again for each action. Other administration needs only the right role.

Invitations, address confirmation and password resets are emailed, so they need the server's email
delivery. Without it, CapacityLens says so instead of sending.

## When someone leaves

In **Team & access**, remove their membership or select **Disable Access**. They lose company access
on their next request. Neither can rejoin until an Owner or Admin selects **Enable Access** under
**No longer active**; a removed person returns with the role they held when removed.
