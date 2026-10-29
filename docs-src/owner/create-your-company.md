---
title: Access your company
description: Create your sign-in, name your company in the browser and open its schedule.
prev: false
next: false
---

<span id="prerequisites"></span>
<span id="steps"></span>
<span id="what-s-next"></span>

# Access your company

Your installer sends you a one-time setup link. Opening it creates your sign-in; naming the company
then makes you its Owner.

## Sign in for the first time

![Accept invite page showing Company setup as the role, with Name, Password and Accept invitation](../screenshots/flows/owner_first_signin_setup.jpg)

1. Open the setup link. **Accept invite** shows **Company setup** as the role.
2. Enter your **Name** and choose a **Password**. Your email is the address the installer used.
3. Select **Accept invitation**.

The link works once and expires after seven days. If it has expired or was already used, ask the
installer for a new one.

## Set up your company

![Set up your company screen with Company name, Week starts on, Time zone and Create company](../screenshots/flows/company_first_run_setup.jpg)

Enter **Company name**, choose whether the week starts on Monday or Sunday, and choose the company's
time zone. Then select **Create company**. These calendar choices are stored with the company and
cannot be changed later. The form starts with Monday and `Etc/GMT` selected. Your company opens on
Schedule, with you as Owner. The service keeps running throughout setup. If a save fails, the values
stay in the form and the error explains what to do before trying again.

The company name may contain up to 100 Unicode code points and must not include unsupported
characters. Invalid input is rejected; the browser does not silently truncate the name.

The company starts with Monday–Friday as working days and day-based scheduling. Company name and
calendar choices are submitted together with the Owner, defaults and built-in Internal client in one
setup operation. No sample scheduling records are added.
Setup is available only when your identity is the only sign-in and no company or membership exists.
The server blocks open signup until your company exists, so another signup cannot interrupt this
first-run setup. If several identities already exist, ask whoever manages hosting to resolve
access. Setup cannot create a second company or replace an Owner.
The temporary [demo](/getting-started/try-the-demo) lets you explore fictional companies without
storing their records.

Next: [Appoint an Admin](/owner/appoint-an-admin) — hand the day-to-day running to someone else.
