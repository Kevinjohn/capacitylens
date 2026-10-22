---
title: Access your company
description: Create your sign-in and ask the installer to initialize company access.
prev: false
next: false
---

<span id="prerequisites"></span>
<span id="steps"></span>
<span id="what-s-next"></span>

# Access your company

Sign in with the setup token from your installer. You need the CapacityLens address and that token.
An identity needs a provisioned company and membership before it can use the schedule.

## Sign in for the first time

![First Owner sign-in setup with Name, Email, Create a password and Owner setup token fields](../screenshots/flows/owner_first_signin_setup.jpg)

1. Open the address. The sign-in page says **Setup the account Owner**.
2. Enter your name, email and password, and paste the token into **Owner setup token**.
3. Select **Create my sign-in**.

The token is not shown again. If you do not have it, or the form rejects it, ask the installer.

If the installer set up [company login](/reference/glossary#company-login), choose that provider
instead and use the email address the installer approved for the first Owner. If no provider
accepts your address, ask the installer to check the first-Owner setup before you try a different
identity.

## Company access

First sign-in creates your identity. The installer then stops the service and runs
`company:initialize` for your existing email and company name. This creates the first company
and makes your identity its Owner. It does not create or change your password, provider identity
or admission settings. After the installer restarts the service, sign in normally to open Schedule.

The company starts with Monday as the first day of the week, Monday–Friday as working days and
day-based scheduling. It contains the built-in Internal client and no sample scheduling records.
The setup command works only before any company or membership exists. Ask the installer to
resolve access if the command refuses; it cannot add a second company or replace an Owner.
The temporary [demo](/getting-started/try-the-demo) lets you explore fictional companies without
storing their records.

Next: [Appoint an Admin](/owner/appoint-an-admin) — hand the day-to-day running to someone else.
