---
title: Set up Google or Microsoft sign-in
description: Register CapacityLens with Google Workspace or Microsoft Entra ID, add its callback address, and configure the matching server settings.
---

# Set up Google or Microsoft sign-in

This guide connects CapacityLens to the Google Workspace or Microsoft Entra ID
account your team already uses. You need access to your provider's admin console
and to the CapacityLens server settings.

CapacityLens sends people to the provider to sign in, then receives them at a
provider-specific callback address. The provider must have the exact callback
address registered. For Google, use `/api/auth/callback/google`; for Microsoft,
use `/api/auth/callback/microsoft`.

## Before you start

Write down the public CapacityLens address from
`SMALLSASS_ACCOUNT_PUBLIC_URL`. Use the same HTTPS address that people use in
their browser, without a trailing slash. For example:

`https://planning.example.com`

Keep the client secret in your secret manager or protected server environment.
Never put it in browser code, a public issue, or a committed configuration file.

## Google Workspace

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and
   select or create a project for CapacityLens.
2. Open **Google Auth Platform**. Complete the app's branding details and set
   **Audience** to **Internal**. This limits the company application to your
   Google Workspace organisation. If Internal is unavailable, ask your Workspace
   administrator to resolve the organisation/project setup before continuing.
3. Under **Clients**, create an OAuth client. Choose **Web application**.
4. Add this value under **Authorised redirect URIs**, replacing the host with
   your public CapacityLens address:

   `https://planning.example.com/api/auth/callback/google`

5. Create the client and copy its **Client ID** and **Client secret**. Google
   shows the client secret when it is created; store it securely.

Google requires the redirect address to match the registered address exactly,
including its scheme, hostname, path, and trailing slash. See Google's guide to
[OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
and [OAuth client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

Set these server values:

```dotenv
SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID=<Google client ID>
SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET=<Google client secret>
```

## Microsoft 365 / Entra ID

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com/)
   with an account that can register applications.
2. Open **Entra ID → App registrations → New registration**. Choose **Single
   tenant only — _your tenant_** (older admin center labels say **Accounts in
   this organisational directory only**), then register the app.
3. On the app's **Overview** page, copy **Application (client) ID** and
   **Directory (tenant) ID**. The tenant ID must be the GUID for your work or
   school tenant. CapacityLens does not accept `common`, `organizations`, or a
   personal Microsoft account tenant.
4. Open **Authentication**, add a **Web** platform, and register this redirect
   URI. Replace the host with your public CapacityLens address:

   `https://planning.example.com/api/auth/callback/microsoft`

5. Open **Certificates & secrets → Client secrets**, create a client secret,
   and copy its **Value** immediately. The **Secret ID** is not the secret
   value. Record the expiry date and plan to replace the secret before it
   expires.

Microsoft recommends single-tenant registrations for apps used by one
organisation. See Microsoft's [application registration
guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
and [web app sign-in
quickstart](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-web-app-sign-in).

Set these server values:

```dotenv
SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID=<Application client ID>
SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET=<client secret Value>
SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID=<Directory tenant GUID>
```

Microsoft sign-in also needs outbound SMTP so CapacityLens can send a mailbox
proof when Entra does not return a verified matching email address. Set all five
mail values before enabling the Microsoft provider:

```dotenv
SMALLSASS_ACCOUNT_MAIL_HOST=<SMTP host>
SMALLSASS_ACCOUNT_MAIL_PORT=587
SMALLSASS_ACCOUNT_MAIL_USER=<SMTP username>
SMALLSASS_ACCOUNT_MAIL_PASSWORD=<SMTP password>
SMALLSASS_ACCOUNT_MAIL_FROM=<verified sender address>
```

CapacityLens uses TLS for SMTP submission. Port `587` uses required STARTTLS;
port `465` uses implicit TLS. The sender must be a valid email address accepted
by your mail service. See [Company login in server
configuration](/self-hosting/configuration#company-login) for the complete
setting reference.

## Permissions, consent and profile pictures

Google requests basic sign-in information through `openid`, `profile` and `email`.
It does not request access to Drive, Calendar or Gmail. Your Workspace administrator
can still block the application under the organisation's
[OAuth app access policy](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

Microsoft requests `openid`, `profile`, `email`, `User.Read` and `offline_access`.
These cover sign-in details, the signed-in person's profile and refresh-token
access. They do not request mailbox contents or calendars. Tenant policy may require
administrator consent. If Microsoft shows an approval request, ask the tenant
administrator to review the registered application's permissions; changing
CapacityLens invitations cannot grant that approval. See Microsoft's
[scopes and permissions reference](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc).

Requesting an email claim does not prove control of that address. CapacityLens
still requires verified-email evidence or the Microsoft mailbox proof below.

Google can supply an HTTPS profile-picture address. The current Microsoft
integration also requests the person's small profile photo from Microsoft Graph,
but receives it as inline image data, which CapacityLens does not accept as an
avatar URL. Do not expect the Microsoft photo to appear automatically. Missing
pictures do not prevent sign-in; CapacityLens uses its normal avatar fallback.
An explicitly configured person avatar takes precedence over a linked sign-in
picture on the schedule.

The final Microsoft consent screens and photo behaviour still need confirmation
in the partner tenant. These permissions describe the installed integration,
not a completed live-tenant test.

## Allow the first person and invite teammates

External sign-in does not make an account eligible by itself. New people need a
verified matching email address and either the first-owner allowance on an
empty installation or an unused CapacityLens invitation.

For the first Owner on a new installation, set
`SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS` to the exact email address the
person will use at Google or Microsoft. This allowance only applies while there
are no users. The first sign-in creates the first identity and closes bootstrap access.
The person then follows **Set up your company** to create their company as Owner.

For everyone else, an Owner or Admin creates an invitation in **Team & access**
and copies its link to send to the intended person. CapacityLens does not email
company invitations. The
invited person opens that invitation and continues with the configured provider.
The verified address must match the invitation. Google supplies verified-email
evidence; Microsoft may need the mailbox proof below. A different address cannot
use that invitation to create an identity.

Connecting a provider to an existing account is a separate action. While signed
in to CapacityLens, open **Account → Security** and, under
**Company sign-in**, choose **Connect Google** or **Connect Microsoft**, and complete provider sign-in. The session must be fresh and the local account email must already be verified.
The provider connection must prove the same email, using Microsoft's mailbox
proof where needed. CapacityLens
does not merge accounts just because their email addresses happen to match.

## Microsoft mailbox proof

When Microsoft does not provide a verified email claim that matches the intended
CapacityLens address, CapacityLens sends a one-time proof link to that mailbox.
The link expires after 15 minutes. Open it in the same browser session to confirm
the mailbox and continue the Microsoft connection. Once the Microsoft identity
is linked, later sign-ins use that saved link and do not send another proof
email.

If the email does not arrive, check the spam folder and ask the server operator
to check the SMTP host, port, username, password, sender address, and delivery
logs. The verification screen offers **Resend verification email** after a
delivery failure; retry is rate limited. If the link has expired, start the
provider connection again. You can cancel the current attempt from the
verification screen and restart it later.

If you cancel Microsoft's own sign-in page, CapacityLens ends that connection
attempt. Return to CapacityLens and start the sign-in or connection again. An
expired or cancelled invitation must be replaced by an Owner or Admin before
the invited person can continue.

## Choose the sign-in mode

On a self-hosted installation, `SMALLSASS_ACCOUNT_MODE=password` keeps password
sign-in alongside configured providers. Google and Microsoft appear above the
password form. GitHub remains an experimental additional option in this mode.

`SMALLSASS_ACCOUNT_MODE=sso` requires a configured company provider and removes
password sign-in. GitHub cannot satisfy this requirement, including through an
older GitHub session. Keep the Google or Microsoft credentials configured.
Connect existing accounts and test the replacement before changing modes; see
[Require company sign-in](/company-login/move-to-single-sign-on).

## Finish setup

Add the settings for the provider you chose to the server's protected
environment, then restart CapacityLens. Open the sign-in page and check that the
matching provider button appears. Complete one sign-in with an allowed account
or an invitation before asking the team to use it.

Google and Microsoft are the supported company sign-in providers. Generic OIDC
configuration is retired; see [company-login configuration](/self-hosting/configuration#company-login)
for the active settings.
