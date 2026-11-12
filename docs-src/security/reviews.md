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
current classification.

## [OpenSSF Baseline self-assessment](/security/OpenSSF-best-practices-dev)

Dated 2026-09-09. Answers every control in OpenSSF Baseline Levels 1–3 with repository evidence,
including explicit unmet controls instead of treating configured tools as proof of enforcement.
Read this when completing or checking the project's public OpenSSF badge entry.

## [Member storage and media verification — 2026-11-01](/security/reviews/member-storage-media-2026-11-01)

A focused follow-up to the structural review: real SQLite and authenticated HTTP tests for malformed
member-directory storage, plus a 64-asset historical-media investigation. It records full-size still
inspection, complete recording/frame coverage, metadata scope, current-demo replay, retention
decisions and the missing original-ledger limitation. Downloadable manifests pin every asset and
frame; this is bounded verification evidence, not a general privacy or security certification.

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

## What's next

Report a vulnerability through the process in the [security policy](https://github.com/Kevinjohn/capacitylens/blob/main/SECURITY.md),
or go back to the [Security and privacy](/security/) for the plain-language summary.
