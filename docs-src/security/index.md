---
title: Security and privacy
description: The security defaults CapacityLens ships with, where the detailed evidence lives, and how to report a vulnerability.
---

# Security and privacy

Check the security defaults CapacityLens ships with, find the detailed evidence, and report a
vulnerability. The operator's configuration, network and backup policy also matter; the
[Self-hosting](/self-hosting/) guide covers them.

## What's on by default

- **Passwords.** Everyone [signs in](/company-login/) with an email address and a password, stored
  with a modern, slow hashing algorithm. Passwords are not checked against a breached-password list.
- **Multi-factor sign-in.** There is none. CapacityLens has no Google, Microsoft or other company
  sign-in through which to require it.
- **Joining.** A new person needs an emailed invitation and an Owner's or Admin's approval before
  they see company data.
- **Sessions.** A session ends after fourteen days without use. The cookie is confined to your
  exact CapacityLens address and held back from cross-site background requests. Signing out ends
  the current session; changing your password ends every session. There is no session list, and no
  one can end a teammate's sessions.
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
