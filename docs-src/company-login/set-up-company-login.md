---
title: Set up Google or Microsoft sign-in
description: Register CapacityLens with Google Workspace or Microsoft Entra ID, add its callback address, and configure the matching server settings.
---

# Set up Google or Microsoft sign-in

Register CapacityLens with Google Workspace or Microsoft Entra ID, then give the server the
matching settings. You need access to your provider's admin console and to the CapacityLens server
settings.

## Before you start

Note your public CapacityLens address from `CAPACITYLENS_PUBLIC_URL`: the HTTPS address people use
in their browser, without a trailing slash. For example:

`https://planning.example.com`

The provider sends people back to a callback address on it, which must be registered exactly:
`/api/auth/callback/google` for Google, `/api/auth/callback/microsoft` for Microsoft.

Keep the client secret in your secret manager or protected server environment. Never put it in
browser code, a public issue or a committed configuration file.

## Register with Google Workspace

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a
   project for CapacityLens.
2. Open **Google Auth Platform**. Complete the branding details and set **Audience** to
   **Internal**, which limits the app to your Google Workspace organisation. If Internal is
   unavailable, ask your Workspace administrator to fix the organisation/project setup first.
3. Under **Clients**, create an OAuth client and choose **Web application**.
4. Under **Authorised redirect URIs**, add this value with your own host:

   `https://planning.example.com/api/auth/callback/google`

   It must match exactly, including scheme, hostname, path and trailing slash.

5. Create the client and copy its **Client ID** and **Client secret**. Google shows the secret
   when it is created; store it securely.
6. Set these server values:

   ```dotenv
   CAPACITYLENS_GOOGLE_CLIENT_ID=<Google client ID>
   CAPACITYLENS_GOOGLE_CLIENT_SECRET=<Google client secret>
   ```

Google's guides: [OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
and [OAuth client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Register with Microsoft 365 / Entra ID

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com/) with an account
   that can register applications.
2. Open **Entra ID → App registrations → New registration**. Choose **Single tenant only — _your
   tenant_** (older labels say **Accounts in this organisational directory only**), then register
   the app.
3. On the app's **Overview** page, copy **Application (client) ID** and **Directory (tenant) ID**.
   The tenant ID must be your work or school tenant's GUID. CapacityLens does not accept
   `common`, `organizations` or a personal Microsoft account tenant.
4. Open **Authentication**, add a **Web** platform and register this redirect URI with your own
   host:

   `https://planning.example.com/api/auth/callback/microsoft`

5. Open **Certificates & secrets → Client secrets**, create a secret and copy its **Value**
   immediately. The **Secret ID** is not the secret. Record the expiry date and replace the secret
   before it expires.
6. Set these server values:

   ```dotenv
   CAPACITYLENS_MICROSOFT_CLIENT_ID=<Application client ID>
   CAPACITYLENS_MICROSOFT_CLIENT_SECRET=<client secret Value>
   CAPACITYLENS_MICROSOFT_TENANT_ID=<Directory tenant GUID>
   ```

Microsoft's guides: [application registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
and [web app sign-in quickstart](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-web-app-sign-in).

Microsoft also needs outbound SMTP, so CapacityLens can send a mailbox proof when Entra does not
return a verified matching email. Set all five mail values before enabling Microsoft:

```dotenv
CAPACITYLENS_MAIL_HOST=<SMTP host>
CAPACITYLENS_MAIL_PORT=587
CAPACITYLENS_MAIL_USER=<SMTP username>
CAPACITYLENS_MAIL_PASSWORD=<SMTP password>
CAPACITYLENS_MAIL_FROM=<verified sender address>
```

SMTP always uses TLS: port `587` uses required STARTTLS, port `465` implicit TLS. The sender must
be an address your mail service accepts. Every setting is listed under
[Company login in server configuration](/self-hosting/configuration#company-login).

## Permissions, consent and profile pictures

Google requests `openid`, `profile` and `email` only, with no access to Drive, Calendar or Gmail.
Your Workspace administrator can still block the app under the organisation's
[OAuth app access policy](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

Microsoft requests `openid`, `profile`, `email`, `User.Read` and `offline_access`: sign-in
details, the person's profile and refresh-token access, with no mailbox contents or calendars.
If Microsoft shows an approval request, the tenant administrator must review and consent to the
app's permissions; a CapacityLens invitation cannot grant that. Microsoft's
[scopes and permissions reference](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)
lists what each one allows.

An email claim alone does not prove control of the address. CapacityLens still requires
verified-email evidence or the [Microsoft mailbox proof](#microsoft-mailbox-proof).

Google can supply a profile picture. Microsoft's photo arrives as inline image data, which
CapacityLens does not accept as an avatar, so do not expect it to appear. Missing pictures do not
block sign-in; the normal avatar fallback is used. An avatar set on the person takes precedence
over a sign-in picture on Schedule and Overview.

Microsoft's consent screens and photo behaviour have not yet been checked in a live tenant.

## Allow the first person and invite teammates

For the first Owner on a new installation, set `CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS` to the
exact email address they will use at Google or Microsoft. It applies only while there are no
users; the first sign-in closes it. That person then follows [Set up your company](/owner/) to
become Owner.

Everyone else joins through the company's
[joining policy](/company-login/#invitations-and-the-first-owner) or an addressed invitation from
an Owner or Admin in **Team & access**. With SMTP configured, CapacityLens emails the invitation;
the copyable link stays available if sending fails. The verified address must match the
invitation, and a different address cannot use it. Google supplies verified-email evidence;
Microsoft may need the mailbox proof.

Existing users connect a provider from **Account → Security**, as
[Connect an existing account](/company-login/#connect-an-existing-account) describes.

## Microsoft mailbox proof

When Microsoft does not provide a verified email that matches the intended CapacityLens address,
CapacityLens sends a one-time link to that mailbox. Open it in the same browser session within
15 minutes, then select **Confirm and continue**. Once the Microsoft identity is linked, later
sign-ins do not send another proof.

### If the mailbox proof fails

- **The email does not arrive.** Check spam, then ask the operator to check the SMTP host, port,
  username, password, sender address and delivery logs. After a delivery failure, the
  verification screen offers **Resend verification email**; retries are rate limited.
- **The link has expired.** Start the provider connection again, or cancel the current attempt
  from the verification screen and restart later.
- **You cancel Microsoft's sign-in page.** CapacityLens ends that attempt; start again.
- **The invitation has expired or been cancelled.** An Owner or Admin must replace it.

## Finish setup

1. Add the provider's settings to the server's protected environment, set
   `CAPACITYLENS_MODE=password-and-sso`, and restart CapacityLens. Production defaults to
   `password-only`, which ignores provider settings. If `CAPACITYLENS_DEPLOYMENT_PROFILE` is set,
   change it to `self-hosted-mixed`.
2. Open the sign-in page and check the provider button appears.
3. Complete one sign-in with an allowed account or an invitation before asking the team to use it.

`CAPACITYLENS_MODE=password-and-sso` keeps passwords alongside the providers.
`CAPACITYLENS_MODE=sso-only` removes passwords; connect existing accounts and test first, as
[Require company sign-in](/company-login/move-to-single-sign-on) describes.

Google and Microsoft are the supported providers.
