---
title: Security overview
description: The security defaults CapacityLens ships with, where the detailed evidence lives, and how to report a vulnerability.
---

# Security overview

This page is for anyone evaluating or operating CapacityLens who wants to know what protects
their data without reading the source code. It summarises the defaults, points to the detailed
evidence for anyone who needs it, and explains how to report a problem.

## What's on by default

- **Sign-in.** Password sign-in checks new and changed passwords against the Have I Been Pwned
  breached-password list before accepting them, and stores them with a modern, slow hashing
  algorithm. Optional [company login](/company-login/) (single sign-on through your identity
  provider) is available as a first-class alternative.
- **Multi-factor sign-in.** An operator can require TOTP (a six-digit code from an authenticator
  app) for every password identity. It is opt-in, not on by default, and is turned on through
  [server configuration](/self-hosting/configuration).
- **Sessions.** A signed-in session lasts twelve hours at most and expires after thirty minutes of
  inactivity. The session cookie is host-only, so it's confined to your exact CapacityLens
  address, and it's held back from cross-site background requests — it's only sent on the
  top-level return from your identity provider during company login. People can see and revoke
  their own sessions, and an administrator can revoke a teammate's.
- **Isolation between companies.** Every request checks the signed-in person's membership and
  role in that specific company before it can read or change anything, so one company's data
  never leaks into another's.
- **No tracking.** CapacityLens ships with no product analytics, advertising or crash-reporting
  service. See [Privacy](/security/privacy) for exactly what is stored and where.

These are the defaults for the self-hosted, open-source application. An operator's own
configuration, network setup and backup policy also matter — see
[Self-hosting](/self-hosting/) for the deployment side of the picture.

## Where the detailed evidence lives

The bullets above are a summary. The full, dated evidence — what was reviewed, what passed, what
is only partial, and what is out of scope — lives in the compliance artifacts. Start at
[Reviews and compliance](/security/reviews) for an index of all of them, including the OWASP ASVS
5.0.0 ledger, the security review, the threat model, the control inventories and the
mutation-testing reviews.

## Report a vulnerability

CapacityLens has a published [security policy](https://github.com/Kevinjohn/capacitylens/blob/main/SECURITY.md)
on GitHub. In short: use
[GitHub private vulnerability reporting](https://github.com/Kevinjohn/capacitylens/security/advisories/new)
rather than a public issue, discussion or pull request, and include the affected
version/commit, prerequisites, reproduction steps and impact. The maintainer aims to acknowledge
reports within five working days. Read the full policy for scope, response process and what is
out of scope.

## What's next

Read [Privacy](/security/privacy) for what data CapacityLens stores and what stays in the
browser, or go straight to [Reviews and compliance](/security/reviews) for the detailed evidence.
