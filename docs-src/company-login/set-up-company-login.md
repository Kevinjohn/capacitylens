---
title: Set up Google sign-in
description: Register CapacityLens with Google, configure its callback and protect the company sign-in credentials.
---

# Set up Google sign-in

Register CapacityLens as a Google web application, then add its credentials to the protected server
environment. You need access to the Google Cloud project and the CapacityLens server settings.

## Before you start

Note the public CapacityLens address in `CAPACITYLENS_PUBLIC_URL`: the HTTPS address people use in
their browser, without a trailing slash. For example:

`https://planning.example.com`

Register this callback address in Google:

`https://planning.example.com/api/auth/callback/google`

Use your own host. The scheme, hostname and path must match exactly. Production uses HTTPS.

Keep the client secret in your secret manager or protected server environment. Never put it in
browser code, a public issue or a committed configuration file.

## Register the Google application

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a
   project for CapacityLens.
2. Open **Google Auth Platform** and complete the branding details. Set **Audience** to
   **Internal** to limit sign-in to your Google Workspace organisation. If Internal is unavailable,
   ask your Workspace administrator to fix the organisation or project setup.
3. Under **Clients**, create an OAuth client and choose **Web application**.
4. Under **Authorised redirect URIs**, add the callback address from `CAPACITYLENS_PUBLIC_URL`:

   `https://planning.example.com/api/auth/callback/google`

5. Create the client and copy its **Client ID** and **Client secret**. Google shows the secret when
   it is created; store it securely.
6. Add these values to the server environment:

   ```dotenv
   CAPACITYLENS_GOOGLE_CLIENT_ID=<Google client ID>
   CAPACITYLENS_GOOGLE_CLIENT_SECRET=<Google client secret>
   ```

Google's guides cover [OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
and [OAuth client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

CapacityLens requests the OpenID, email and basic profile scopes only. A verified Google email is
required for sign-in. CapacityLens uses Google's stable account identity, never an email match, to
recognise a returning sign-in.

## Allow the first Google identity

On a new installation, set `CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS` to the exact verified email
address allowed to create the first Google identity. It applies only while no user exists. The
Google callback creates the sign-in identity and session, but no company or membership. Access
requires a provisioned company and membership; see [Access your company](/owner/) for the current
first-company limitation.

After the first identity exists, a new Google identity needs an unused invitation addressed to its
verified Google email. A company joining policy cannot create a new sign-in identity.

## Choose a sign-in mode

For password and Google sign-in, set:

```dotenv
CAPACITYLENS_MODE=password-and-sso
CAPACITYLENS_DEPLOYMENT_PROFILE=self-hosted-mixed
```

To require Google sign-in, use `CAPACITYLENS_MODE=sso-only` with the matching SSO-only profile. This
removes password sign-in. Confirm a Google sign-in with an allowed account before requiring it for
the team. [Require Google sign-in](/company-login/move-to-single-sign-on) explains the operator
procedure and marks the legacy-server cutover commands separately.

An existing password account can connect Google from **Account → Security**. The session must be
fresh, the local email must be verified, and the verified Google email must match it. CapacityLens
never merges identities because their email addresses match.
