---
title: How sign-in works
description: The three ways to sign in to CapacityLens, how they stay linked to the same person, and how sessions and two-factor codes work.
---

# How sign-in works

CapacityLens supports three ways for someone to sign in: a password, a social sign-in
button, or your company's own login system (single sign-on). Every installation
supports at least one of these; most self-hosted installations start on passwords and
move to company login later. This page explains what each mode is, how a person stays
"the same person" no matter which one they use, and how sessions and two-factor codes
work. If you're ready to set company login up, skip to [Set up your company
login](/company-login/set-up-company-login); if you're moving an existing team off
passwords, go to [Move from passwords to single sign-on](/company-login/move-to-single-sign-on).

## The three ways to sign in

**Password.** The person types an email address and password they created. On a fresh
self-hosted install, the first person in signs up with a one-time setup token; everyone
after that needs an invitation. This is the fastest way to start, and it's the default
for a new installation.

**Social sign-in.** A "Continue with Google" or "Continue with Microsoft" style button.
These are marked **experimental** in CapacityLens: they work, but they're a lighter-weight
option than company login and aren't accepted on installations that require company login.
Treat them as a convenience for people who already have one of those accounts, not as your
main door.

**Company login.** Also called single sign-on, or SSO. The person clicks "Continue with
[your company]" and is sent to the [identity provider](/reference/glossary) your
company already uses to sign people into everything else — Google Workspace, Microsoft
365, Okta, Keycloak — signs in there exactly as normal, and is sent back signed in to
CapacityLens. CapacityLens never sees their password. Behind the scenes this uses a
standard called OIDC (OpenID Connect), the same one almost every modern identity
provider speaks.

![The CapacityLens sign-in page in mixed mode, showing the email and password form above a Continue with Northwind Identity button](../screenshots/flows/sso-login-mixed.jpg)

Company login is the recommended mode once your team is bigger than a handful of
people, because it means nobody has a CapacityLens-specific password to remember, lose,
or reuse — and when someone leaves the company, disabling their account at the identity
provider is most of the job done. See [Set up your company
login](/company-login/set-up-company-login) to configure it.

## How accounts link together

Whichever mode someone signs in with, they're still one person: the same membership,
the same role, the same allocations on the schedule. CapacityLens keeps that link by
having each person **prove** the connection themselves, rather than guessing from an
email address.

For example: Dave signed up for CapacityLens with the password `dave@agency.com`, but
his company's login system knows him as `david.smith@agency.co.uk`. CapacityLens
won't silently treat those as the same person just because they sound alike. Instead,
Dave signs in with his password as usual, goes to Settings, and clicks **Connect** next
to company login. He's sent to that login system, signs in there, and comes back —
and only then are the two identities linked. From that point on, CapacityLens
remembers him by a stable ID the login system issues (not by his email address), so
even if his email changes again later, the link holds.

![The Company sign-in card in Settings, explaining that the organisation is moving to Northwind Identity sign-in, with a Connect Northwind Identity button](../screenshots/flows/sso-settings-connect.jpg)

The one rule that can't be skipped: at the moment someone connects, the email their
login system reports has to be **identical** to their CapacityLens email. If it
isn't, an Owner or Admin can correct the CapacityLens side to match — see [Move from
passwords to single sign-on](/company-login/move-to-single-sign-on) for that repair
step. Nobody has to change anything on the login system's side.

## Sessions and staying signed in

A CapacityLens session lasts at most twelve hours from the moment someone signs in, and
doesn't renew itself just because they're active — after twelve hours, they sign in
again regardless. Separately, thirty minutes with no activity also signs someone out.

A handful of sensitive actions — changing a password, resetting someone else's
password, removing a member, exporting data, deleting a company — need a session that's
"fresh": if it's been more than fifteen minutes since the person last proved who they
are, CapacityLens asks them to confirm again (their password, or a two-factor code)
before letting the action through. This doesn't sign them out or lose their place; it's
a quick check in place.

## Extra security: two-factor sign-in

In password mode, an Owner or Admin can require everyone to enroll in two-factor
sign-in — [TOTP](/reference/glossary), the six-digit code from an authenticator app
that changes every thirty seconds. Once required, a new person has to finish
enrolling before they can see any company data. Enrolling also gives them one-time
recovery codes to use if they lose their authenticator; five wrong codes in a row locks
the account for fifteen minutes.

There's deliberately no administrator override for lost two-factor codes: if someone
loses both their authenticator and their recovery codes, getting them back in requires
the person who runs the server, not a button in the product. This is covered in the
self-hosting documentation.

Company login sidesteps this entirely — CapacityLens treats every company-login session
as already meeting its two-factor requirement, because your identity provider is
responsible for its own sign-in policy (including whether it requires two-factor
codes). If your identity provider doesn't enforce two-factor sign-in, turning it on
there gives your team the same protection.

## Which mode is right for you

| Situation                                                                                | Recommended mode                                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Trying CapacityLens out, or a very small trusted team                                    | Password, or [the demo](/getting-started/try-the-demo) with no sign-in at all                               |
| A self-hosted team without a shared identity provider                                    | Password, with two-factor sign-in required                                                                  |
| A team that already signs into Google, Microsoft, Okta or Keycloak for everything else   | [Company login](/company-login/set-up-company-login)                                                        |
| An existing password team that wants to move to company login without locking anyone out | Run both at once first — see [Move from passwords to single sign-on](/company-login/move-to-single-sign-on) |

Self-hosted installations can run password-only, company-login-only, or both at once
(useful for keeping contractors on passwords while staff use company login). Whichever
you choose is a setting on your own server — see
[Configuration](/self-hosting/configuration) for the full list of options.

## What's next

[Set up your company login](/company-login/set-up-company-login) to connect
CapacityLens to Google, Microsoft, Okta or Keycloak, or [Move from passwords to single
sign-on](/company-login/move-to-single-sign-on) if you already have a password team.
