---
title: Access your company
description: Sign in, check company access, invite an Admin and hand over.
prev: false
next: false
---

<span id="your-route"></span>
<span id="set-up"></span>
<span id="when-you-are-done"></span>
<span id="what-s-next"></span>

# Access your company

If your installation has a provisioned company and your identity has Owner membership, you can
give someone the day-to-day running of it. Sign-in setup alone does not create that company.

You need the CapacityLens address and the [setup token](/reference/glossary#setup-token) from
whoever installed it.

<div class="steps">

1. ![Owner sign-in setup form with name, email, Create a password and Owner setup token fields and Create my sign-in](../screenshots/steps/owner_setup_sign_in_form.png)

   **Sign in for the first time.** Open the address. Enter your name, email and a password, and
   paste the setup token into **Owner setup token**. Select **Create my sign-in**. The token works
   once. If your installer set up Google sign-in, choose that instead.

2. **Check company access.** If the installation has no company, the current native release has no
   supported first-company provisioning screen or command. Ask your installer about this limitation.
   The [demo](/getting-started/try-the-demo) lets you edit fictional companies, but its changes are
   lost on reload.

3. ![Invite someone dialog with Role set to Admin, an email address, No Resource linked and Create invite](../screenshots/steps/owner_invite_admin_dialog.png)

   **Invite an Admin.** Open **Team & access** and select **Invite someone**. Set **Role** to
   **Admin**, enter their email and select **Create invite**. CapacityLens emails the invitation
   if email is set up. If it isn't, select **Copy** and send them the link yourself.

4. ![Members table listing each person's name, role and email, with an accepted member showing the Admin role](../screenshots/steps/owner_members_admin_row.png)

   **Hand over.** Until they accept, the invitation waits under **Outstanding invites**. When
   their row in **Team & access** shows **Admin**, send them [Get the schedule ready](/admin/).
   They take it from here.

</div>

Running the company yourself as well? Skip step 3 and go straight to
[Get the schedule ready](/admin/).

## What stays with you

Appointing an Admin does not make them the Owner. Deciding who can join, transferring ownership,
and importing data stay with you.
[Owner responsibilities](/owner/responsibilities) covers each of them.

<span id="in-more-detail"></span>

## Go further

- [Access your company](/owner/create-your-company): company login, a rejected token, and the
  first-company limitation.
- [Appoint an Admin](/owner/appoint-an-admin): lost links, pending invitations and linking a
  scheduled person.
- [Roles and permissions](/getting-started/roles-and-permissions) for what each role can see and
  do.
- [Owner FAQ](/owner/faq)
