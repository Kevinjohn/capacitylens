---
title: Reviews and compliance
description: An index of CapacityLens's dated security review, threat model, control inventories, ASVS ledger and mutation-testing reviews.
---

# Reviews and compliance

CapacityLens keeps a set of dated, evidence-based security documents alongside the code, instead
of a one-off claim of "secure by design". They are written for security reviewers, auditors and
technical evaluators, not for a first read of the product — start at the
[Security overview](/security/) if that is what you need. Each artifact below is reproduced as-is
on its own page; this page just explains what each one is and when to reach for it.

## [OWASP ASVS 5.0.0 ledger](/security/owasp-asvs-5.0.0)

Dated 2026-07-14. Every one of the 345 requirements in the OWASP Application Security
Verification Standard 5.0.0 (covering Levels 1 to 3), assessed as Pass, Partial, Gap or Not
Applicable, with the repository evidence behind each one. Read this when you need to check a
specific control by ASVS requirement id, or want the complete picture rather than a summary.

## [Security review — 2026-07-14](/security/security-review-2026-07-14)

A point-in-time source-code review against the ASVS ledger above, plus the OWASP Top 10 and API
Security Top 10. It explains the review's scope and method, lists findings and how they were
treated, and states plainly what is a code guarantee, what is an inherited library guarantee, and
what is left to the self-hosting operator. Read this for the narrative version of the ASVS ledger
— what was found, fixed and accepted, and why.

## [Threat model](/security/threat-model)

Dated 2026-07-14. States CapacityLens's security objectives in plain terms, lists the assets and
trust boundaries being protected, names the realistic attackers (a malicious teammate, a
credential-stuffing bot, a compromised identity provider, a careless operator, and more), and maps
each abuse case to the controls and tests that address it. Ends with the risks that are
consciously accepted rather than fixed. Read this to understand *why* a control exists, not just
that it does.

## [Control inventories](/security/control-inventories)

Dated 2026-07-14. The reference tables behind the threat model and ASVS ledger: every entry point
and untrusted input, every class of sensitive data and how long it is kept, the full cryptographic
inventory (what algorithm protects what, and its key lifecycle), service and rate limits, and the
audit/security event log. Read this when you need the specific technical detail — for example,
exactly what algorithm hashes a password, or exactly how long a session token lives.

## [Mutation-test review — 2026-07-15](/security/mutation-review-2026-07-15)

The first review of CapacityLens's mutation-testing results (a technique that deliberately
introduces small bugs into the code to check whether the test suite catches them) read for
security meaning rather than raw score. It found and fixed one real defence-in-depth defect in
tenant-data validation, and records which parts of the codebase the mutation score does — and does
not — cover.

## [Mutation-test review — 2026-07-18](/security/mutation-review-2026-07-18)

A follow-up review after a test-scope correction (two React hooks had been wrongly included in
the mutation run). Confirms the corrected 92.37% score, with tenant isolation, private-name
handling and password-reset failure mapping all still at 100%. Read the two mutation reviews
together for the current state of that evidence and what it does not claim to cover.

## What's next

Report a vulnerability through the process in the [security policy](https://github.com/Kevinjohn/capacitylens/blob/main/SECURITY.md),
or go back to the [Security overview](/security/) for the plain-language summary.
