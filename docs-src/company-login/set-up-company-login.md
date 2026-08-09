---
title: Set up your company login
description: Create one app inside Google, Microsoft, Okta or Keycloak and copy three values into CapacityLens — about ten minutes, no certificates.
---

# Set up your company login

You're going to create one "app" inside the system your company already uses to sign
people in — Google, Microsoft, Okta, Keycloak — and copy three values out of it into
CapacityLens. It takes about ten minutes. Nothing to install, no certificates, no XML.

You need to be an administrator of that system — the person who can add users to
Google Workspace or Microsoft 365. If that isn't you, this is a ten-minute favour to
ask of whoever it is.

## What you're actually doing

When someone clicks **"Continue with company login"** in CapacityLens, they get bounced
over to Google (or Microsoft, or Okta), sign in there exactly as they do for email, and
get bounced back. CapacityLens never sees their password. For that handshake to work,
the two systems have to know about each other: your provider needs to know CapacityLens
exists and where to send people back to, and CapacityLens needs to know where your
provider lives and what its password — sorry, its [client
secret](/reference/glossary#client-secret) — is.

So the job is: create the app in your provider, paste one address _into_ it, and copy
three values _out_ of it. That's the whole thing.

## 1. Work out the one address you'll paste in

Every provider asks for the same thing, under a slightly different name — "[redirect
URI](/reference/glossary#redirect-uri)", "callback URL", "sign-in redirect URI". They
all mean "where do I send people back to?" Yours is your CapacityLens web address with
a fixed tail on the end:

```text
https://planning.your-agency.com/api/auth/oauth2/callback/sso
```

Swap in your own address for the first part; leave the tail (`/api/auth/oauth2/callback/sso`)
exactly as it is.

The first part must be identical to the `SMALLSASS_ACCOUNT_PUBLIC_URL` you already run
CapacityLens on — same `https`, same hostname, no trailing slash. The tail is fixed.
Providers compare this character for character, so a stray slash or an `http` where you
meant `https` is the single most common reason the first click fails.

::: tip
Write your redirect URI down now, in a note you can copy from. You'll paste it once
into your provider and never think about it again.
:::

## 2. Collect three values from your provider

Whichever provider you use, you're hunting for the same three things. Everything after
this section is just where each provider hides them.

| What it's called | What it looks like                                                                         | What it's for                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Client ID        | A longish public string. Not secret.                                                       | CapacityLens introduces itself with this.                                                                  |
| Client secret    | A random string, usually shown **once**. Genuinely secret — treat it like a root password. | Proves the introduction is really from your server.                                                        |
| Discovery URL    | An address ending `/.well-known/openid-configuration`                                      | One address that tells CapacityLens all the others. It's why you never have to type web addresses by hand. |

::: tip The trick that saves you an hour
Open the discovery URL in a browser. You'll get a wall of JSON. Near the top is a field
called `"issuer"`. Copy its value exactly — that's your fourth setting, the
[issuer](/reference/glossary#issuer), and it has to match to the character. Guessing
the issuer instead of reading it is the number one reason the first sign-in click fails.
:::

## 3. Find your provider and follow the clicks

Open the section for the provider you use. If yours isn't listed, [Anything
else](#anything-else) tells you what to look for — the steps are almost identical
everywhere, because they're all doing the same job.

### Google Workspace

For teams that use Gmail for work.

::: tip
Provider consoles change their layout often, so treat the numbered steps below as
approximate breadcrumbs, not an exact map. If a screen doesn't match, [Google's own
guide to creating an OpenID Connect
app](https://developers.google.com/identity/protocols/oauth2/openid-connect) is the
authoritative source.
:::

1. Go to `console.cloud.google.com` and sign in with an administrator account. (Yes,
   the cloud console, not the Workspace admin console — logins live here.)
2. At the top, **pick a project or create one**. If in doubt, create one called
   `CapacityLens`. A project is just a folder.
3. In the left menu open **APIs & Services → OAuth consent screen**. Choose
   **Internal** — that means only people in your own organisation can ever use this
   login. Put in an app name your staff will recognise and a support email. Save.
4. Now **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   Application type: **Web application**.
5. Under **Authorised redirect URIs**, click **Add URI** and paste the address you
   wrote down. Click **Create**.
6. Google shows your **Client ID** and **Client secret** in a box. Copy both now. The
   secret can be regenerated later, but not re-read.

Your other two values are the same for every Google customer:

```text
Discovery URL   https://accounts.google.com/.well-known/openid-configuration
Issuer          https://accounts.google.com
```

### Microsoft 365 / Entra ID

For teams that use Outlook for work.

::: tip
Provider consoles change their layout often, so treat the numbered steps below as
approximate breadcrumbs, not an exact map. If a screen doesn't match, [Microsoft's own
guide to registering an
app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
is the authoritative source.
:::

1. Go to `entra.microsoft.com` and sign in as an administrator.
2. Open **Applications → App registrations → New registration**.
3. Name it `CapacityLens`. For account types choose **"Accounts in this
   organizational directory only"** — your staff, nobody else.
4. Under **Redirect URI**, pick the platform **Web** and paste your address. Click
   **Register**.
5. You land on the Overview page. Copy the **Application (client) ID** — that's your
   client ID — and also the **Directory (tenant) ID**, which is Microsoft's name for
   "your company". You need it in a moment.
6. Go to **Certificates & secrets → Client secrets → New client secret**. Copy the
   **Value** column immediately — not the "Secret ID". It is hidden forever once you
   leave the page. Note the expiry date in your calendar; Microsoft secrets expire and
   your login stops working the day they do.

Build your last two values from the tenant ID you copied:

```text
Discovery URL   https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration
Issuer          https://login.microsoftonline.com/<tenant-id>/v2.0
```

::: warning
Microsoft is the one provider that sometimes doesn't tell CapacityLens whether an email
address is verified, and CapacityLens insists on being told. If sign-in gets refused
with a message about a verified email address, open **Token configuration** on the app
you just made, add the optional `email` item, and try again.
:::

### Okta

For teams that already have a dedicated login product.

::: tip
Provider consoles change their layout often, so treat the numbered steps below as
approximate breadcrumbs, not an exact map. If a screen doesn't match, [Okta's own guide
to creating an OIDC app
integration](https://help.okta.com/en-us/content/topics/apps/apps-app-integration-wizard-oidc.htm)
is the authoritative source.
:::

1. In the Okta admin console open **Applications → Applications → Create App
   Integration**.
2. Sign-in method: **OIDC — OpenID Connect**. Application type: **Web Application**.
   Next.
3. Name it `CapacityLens`. Leave the grant type as **Authorization Code**.
4. **Sign-in redirect URIs**: paste your address. The sign-out redirect can be your
   plain CapacityLens address.
5. Under assignments, limit it to the groups who should be able to get in. Save.
6. On the **General** tab, copy the **Client ID** and **Client secret**.

Okta gives you a choice of authorisation server, so read the issuer rather than
guessing it. The usual one is:

```text
Discovery URL   https://<your-org>.okta.com/oauth2/default/.well-known/openid-configuration
Issuer          https://<your-org>.okta.com/oauth2/default
```

Open that discovery URL in a browser and copy the `"issuer"` value it actually
reports. If your Okta uses the org authorisation server instead, both addresses lose
the `/oauth2/default` part.

### Keycloak

For teams that self-host their logins too.

::: tip
Provider consoles change their layout often, so treat the numbered steps below as
approximate breadcrumbs, not an exact map. If a screen doesn't match, [Keycloak's own
guide to OIDC clients](https://www.keycloak.org/docs/latest/server_admin/#_oidc_clients)
is the authoritative source.
:::

1. Open the Keycloak admin console and pick the realm your staff are in — Keycloak's
   word for a set of users.
2. **Clients → Create client**. Type: **OpenID Connect**. Client ID: `capacitylens`.
   Next.
3. Turn **Client authentication** on, leave **Standard flow** ticked. Next.
4. Put your address into **Valid redirect URIs**. Save.
5. Open the **Credentials** tab and copy the **Client secret**.

Your client ID is whatever you typed in step 2. The other two follow the realm name:

```text
Discovery URL   https://<your-keycloak>/realms/<realm>/.well-known/openid-configuration
Issuer          https://<your-keycloak>/realms/<realm>
```

::: warning
Users you created by hand in Keycloak usually have **Email verified** switched off, and
CapacityLens will refuse them. Switch it on for each person, or have them verify by
email, before you send anyone to sign in.
:::

### Anything else

Authentik, Auth0, Ping, or your own — every provider above speaks the same standard
language, called OpenID Connect, so anything else that speaks it works too. Create a
"web application", paste in your redirect address, and collect the same three values.

::: tip This part is for whoever runs your login system
The checklist below gets technical fast, on purpose — it's not written for a general
reader. If that isn't you, stop here and forward this section to whoever administers
your [identity provider](/reference/glossary), word for word. They'll recognise every term in it; virtually
every provider ticks all of it by default anyway.
:::

- It publishes a **discovery document** at `/.well-known/openid-configuration`.
  CapacityLens reads every endpoint from there and won't accept hand-typed ones.
- It supports the **authorisation code flow with [PKCE](/reference/glossary#pkce)**.
  That's the normal choice for a "web application". Not implicit, not device code.
- It signs tokens with **RS256, PS256, ES256 or EdDSA**. Shared-secret signing (HS256)
  is rejected outright — it's the weak option, and it isn't offered by anything modern.
- It reports whether an email address is **verified**, and says yes for your staff. An
  unverified address is never admitted.
- It gives each person a **stable ID** that doesn't change (both "public" and
  "pairwise" styles are fine), and it's served over **HTTPS**.

Ask for the scopes `openid profile email` — that's "who you are, your name, your email
address", and it's all CapacityLens ever wants to know.

## 4. Paste the values into CapacityLens

Six lines in the settings file CapacityLens reads when it starts (the `.env` file, or
however you set environment variables where you run it). Four are the values you just
collected; the last two say what the button should be called and what to ask for.

```dotenv
SMALLSASS_ACCOUNT_OIDC_CLIENT_ID=<the client ID you copied>
SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET=<the client secret you copied>
SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL=https://identity.your-agency.com/.well-known/openid-configuration
SMALLSASS_ACCOUNT_OIDC_ISSUER=https://identity.your-agency.com
SMALLSASS_ACCOUNT_OIDC_SCOPES=openid profile email
SMALLSASS_ACCOUNT_OIDC_LABEL=Northwind Identity
```

`LABEL` is simply the words printed on the button your staff will click, so use the
name they'd recognise: "Google", "Company login", "Northwind Identity". Keep the client
secret wherever you keep your other secrets — not in a file you commit.

::: warning Use these settings, not the separate Google or Microsoft buttons
CapacityLens also has stand-alone `..._GOOGLE_...` and `..._MICROSOFT_...` settings for
people who want a social sign-in button. They're a different door, and connections made
through them don't count towards an SSO cutover. If you're setting up your company's
login, the `..._OIDC_...` settings above are the ones you want — even when the company
is on Google.
:::

## 5. Check it worked

Restart CapacityLens and load the sign-in page. You should see a new button with your
label on it. Click it: you should land on your provider's own sign-in screen, and come
straight back.

![The CapacityLens sign-in page in mixed mode, showing the email and password form above a Continue with Northwind Identity button](../screenshots/flows/sso-login-mixed.jpg)

Two different things can go wrong, and CapacityLens handles them differently. If a
setting is **missing or malformed** — no client secret, no discovery URL — **the server
refuses to start rather than starting half-configured**, and names the setting it
didn't like in its own terminal output. That's a feature — nothing has changed in your
database, so fix the line and start it again. If every setting is _present_ but one of
the _values_ is wrong — a stale issuer, an unreachable discovery URL, a provider
offering the wrong signing algorithm — the server starts normally, and the failure only
shows up the first time someone clicks the button: they land back on the CapacityLens
sign-in screen with a general apology, and the specific reason is written to the
server's own log at that moment, not to the screen.

Some rows below quote the exact words you'll see; others describe what's happening in
plain language because the real text is provider-specific or only ever written to a
log. The **Where** column says which is which: _sign-in screen_ is the CapacityLens
page everyone sees; _server log_ is your terminal or log file, for the operator only;
_provider's page_ is a screen CapacityLens doesn't control.

| What you see                                                                                                                                                         | Where                                                                                            | What it means                                                                                                                                                                                              | What to do                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capacitylens-server: refusing to start —` followed by the setting it didn't like                                                                                    | Server log (paraphrase of the general shape; the exact wording depends which setting is missing) | A required setting — client ID, client secret, discovery URL or issuer — is missing or empty.                                                                                                              | Add the missing line to your settings file and start the server again.                                                                                                                          |
| "Single sign-on was not completed. Try again or contact your administrator."                                                                                         | Sign-in screen (quoted verbatim)                                                                 | The generic message shown for most first-click failures, including a stale issuer, an unreachable discovery URL, and a rejected signing algorithm.                                                         | Check the server's own log at the moment of the click — it names the specific reason, for example "OIDC discovery issuer does not match the configured issuer." Fix that setting and try again. |
| The provider says "redirect_uri_mismatch"                                                                                                                            | Provider's page (their own wording, not CapacityLens's)                                          | The address you registered isn't exactly the one CapacityLens sends.                                                                                                                                       | Compare them character by character — trailing slash, `http` vs `https`, www or not.                                                                                                            |
| "Your identity provider returned information that could not be verified. Ask your administrator to check the OIDC issuer, claims, and verified-email configuration." | Sign-in screen (quoted verbatim)                                                                 | The provider isn't telling CapacityLens the address is verified. Usually Keycloak's **Email verified** switch is off, or Microsoft isn't sending the `email_verified` [claim](/reference/glossary#claims). | Mark the address verified in your provider (Keycloak), or add the `email` item (Microsoft), then have the person try again.                                                                     |
| Button works, but the person can't get in                                                                                                                            | Sign-in screen (plain-language description; access control shows its own separate message)       | Sign-in succeeded; they're just not a member yet, or not invited.                                                                                                                                          | That's access control doing its job — invite them, or connect their existing account.                                                                                                           |

## What happens next depends on where you started

**Brand-new install?** You're finished — carry on with [Invite your
team](/getting-started/invite-your-team).

**Already have people signed up with email and password?** Don't switch everyone over
yet. There's a staged, reversible procedure for that, and it starts by running both
doors open at once so nobody gets locked out: [Move from passwords to single
sign-on](/company-login/move-to-single-sign-on).

## What's next

[Move from passwords to single sign-on](/company-login/move-to-single-sign-on) if you
already have a password team, or back to [How sign-in works](/company-login/) for the
concepts behind company login.
