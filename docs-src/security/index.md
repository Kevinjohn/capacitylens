---
title: Security overview
description: The security defaults CapacityLens ships with, where the detailed evidence lives, and how to report a vulnerability.
---

# Security overview

Check the security defaults CapacityLens ships with, find the detailed evidence, and report a
vulnerability. The operator's configuration, network and backup policy also matter; the
[Self-hosting](/self-hosting/) guide covers them.

## What's on by default

- **Passwords.** New and changed passwords are checked against the Have I Been Pwned
  breached-password list and stored with a modern, slow hashing algorithm.
  [Company login](/company-login/) through Google or Microsoft is a first-class alternative.
- **Multi-factor sign-in.** There is no local MFA. If your agency requires MFA, configure it in
  Google's or Microsoft's own policy; CapacityLens cannot enforce or verify it.
  [Multi-factor sign-in at your provider](/company-login/#multi-factor-sign-in-at-your-provider)
  explains the limits.
- **Sessions.** A session lasts at most twelve hours and expires after thirty minutes of
  inactivity. The cookie is host-only, confined to your exact CapacityLens address, and held back
  from cross-site background requests; it is only sent on the top-level return from your identity
  provider during company login. Signing out ends the current session; changing a local password
  revokes your other sessions. Account shows no session list. An authorised Owner or Admin can revoke a
  teammate's sessions in **Team & access**.
- **Isolation between companies.** Every request checks the signed-in person's membership and role
  in that company before reading or changing anything.
- **No tracking.** No product analytics, advertising or crash-reporting service.
  [Privacy](/security/privacy) lists what is stored and where.

## Find the detailed evidence

[Reviews and compliance](/security/reviews) indexes the dated evidence: what was reviewed, what
passed, what is partial and what is out of scope. It includes the OWASP ASVS 5.0.0 ledger, the
security review, the threat model, the control inventories and the mutation-testing reviews.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Kevinjohn/capacitylens/security/advisories/new),
never a public issue, discussion or pull request. Include the affected version or commit,
prerequisites, reproduction steps and impact. The maintainer aims to acknowledge reports within
five working days. The full [security policy](https://github.com/Kevinjohn/capacitylens/blob/main/SECURITY.md)
covers scope and the response process.
