---
title: Reviews and compliance
description: An index of CapacityLens's security reviews, threat model, control inventories, ASVS ledger and OpenSSF Baseline assessment.
---

# Reviews and compliance

CapacityLens keeps a set of dated, evidence-based security documents alongside the code, instead
of a one-off claim of "secure by design". They are written for security reviewers, auditors and
technical evaluators, not for a first read of the product — start at the
[Security and privacy](/security/) if that is what you need. Each artifact below is reproduced as-is
on its own page; this page just explains what each one is and when to reach for it.

## [OWASP ASVS 5.0.0 ledger](/security/owasp-asvs-5.0.0)

The original assessment is dated 2026-08-18 for alpha4. The ledger now includes a 2026-10-26
amendment for the Account Kit cutover. It assesses all 345 requirements in the OWASP Application
Security Verification Standard 5.0.0 (Levels 1 to 3) as Pass, Partial, Gap or Not Applicable, with
repository evidence behind each one. Read it to check a specific ASVS requirement or see the
current classification; the dated security reviews remain point-in-time records.

## [OpenSSF Baseline self-assessment](/security/OpenSSF-best-practices-dev)

Dated 2026-09-09. Answers every control in OpenSSF Baseline Levels 1–3 with repository evidence,
including explicit unmet controls instead of treating configured tools as proof of enforcement.
Read this when completing or checking the project's public OpenSSF badge entry.

## [Security review — 2026-08-18](/security/reviews/security-review-2026-08-18)

The alpha4 reassessment covered the complete source at that time and the security-relevant delta
since July. It records the fixed session-idle, strict-OIDC SSRF and provider-token findings, refreshed
the threat model and inventories, and reconciled all 345 ASVS controls with the CI and ZAP evidence
available then. Its identity-provider findings describe the 2026-08-18 product state, before the
Account Kit password-only cutover.

## [Security review — 2026-07-14](/security/reviews/security-review-2026-07-14)

A point-in-time source-code review against the ASVS ledger above, plus the OWASP Top 10 and API
Security Top 10. It explains the review's scope and method, lists findings and how they were
treated, and states plainly what is a code guarantee, what is an inherited library guarantee, and
what is left to the self-hosting operator. Read this for the narrative version of the ASVS ledger
— what was found, fixed and accepted, and why.

## [Threat model](/security/threat-model)

Current authentication posture reviewed 2026-10-26 against the Account Kit password-only cutover.
The threat model states CapacityLens's security objectives, assets, trust boundaries, realistic
attackers (including a malicious teammate, credential-guessing bot, mailbox access and a careless
operator), and maps abuse cases to controls and tests. It distinguishes current controls from
accepted risks; it is not a fresh review of the full model.

## [Control inventories](/security/control-inventories)

Reviewed 2026-10-26. These reference tables support the threat model and ASVS ledger: entry points,
untrusted input, sensitive-data classes and retention, cryptographic controls, service limits and
audit events. They distinguish application controls from operator-managed deployment evidence.

## [Mutation-test review — 2026-07-15](/security/reviews/mutation-review-2026-07-15)

The first review of CapacityLens's mutation-testing results (a technique that deliberately
introduces small bugs into the code to check whether the test suite catches them) read for
security meaning rather than raw score. It found and fixed one real defence-in-depth defect in
tenant-data validation, and records which parts of the codebase the mutation score does — and does
not — cover.

## [Mutation-test review — 2026-07-18](/security/reviews/mutation-review-2026-07-18)

A follow-up review after a test-scope correction (two React hooks had been wrongly included in
the mutation run). Confirms the corrected 92.37% score, with tenant isolation, private-name
handling and password-reset failure mapping all still at 100%. Read the two mutation reviews
together for the current state of that evidence and what it does not claim to cover.

## What's next

Report a vulnerability through the process in the [security policy](https://github.com/Kevinjohn/capacitylens/blob/main/SECURITY.md),
or go back to the [Security and privacy](/security/) for the plain-language summary.
