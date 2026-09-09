---
title: OpenSSF Baseline self-assessment
description: CapacityLens answers every OpenSSF Baseline Level 1, 2 and 3 control with repository evidence and visible gaps.
---

# Review the OpenSSF Baseline self-assessment

This page records CapacityLens's answers to every control in OpenSSF Baseline Levels 1–3. It helps
maintainers complete the public assessment and shows contributors where stronger controls are still
needed. The public [OpenSSF project record](https://www.bestpractices.dev/projects/14555) remains the
authoritative badge status.

The assessment uses the [`v2026.02.19` criteria](https://www.bestpractices.dev/en/projects/1/baseline-1)
currently presented by BadgeApp and was reviewed against the repository on 9 September 2026. The
upstream OSPS Baseline published [`v2026.08.28`](https://baseline.openssf.org/versions/2026-08-28) on
28 August 2026, but BadgeApp has not yet adopted that version. Reconcile this ledger when its public
questionnaire changes. **Met** means the repository or its GitHub configuration supplies evidence.
**Unmet** identifies real work still required. **N/A** includes a reason. This document does not claim
that an unsubmitted level has been awarded.

## Project information

| Question | Answer |
| --- | --- |
| What is the project's human-readable name? | CapacityLens |
| What does the project do? | CapacityLens is a self-hosted, week-by-week agency capacity scheduler. It shows availability, allocations, time off and over-capacity warnings so agencies can make informed staffing decisions. |
| What is the project URL? | [github.com/Kevinjohn/capacitylens](https://github.com/Kevinjohn/capacitylens) |
| What is the source repository URL? | [github.com/Kevinjohn/capacitylens](https://github.com/Kevinjohn/capacitylens) |
| Which licence covers the project? | `AGPL-3.0-only`; see [`LICENSE`](https://github.com/Kevinjohn/capacitylens/blob/main/LICENSE). |
| Which implementation languages are used? | TypeScript, JavaScript, CSS and HTML. BadgeApp may group TypeScript under JavaScript. |
| What is the Common Platform Enumeration name? | None. CapacityLens has no assigned CPE. |
| Are there other relevant comments? | The security set includes a threat model, control inventories, an OWASP ASVS 5.0.0 ledger and dated reviews. CI includes CodeQL, dependency review, secret scanning, SBOM generation, container scanning and OWASP ZAP. |

## Baseline Level 1

| Control and question | Answer | Evidence or reason |
| --- | --- | --- |
| `OSPS-AC-01.01` — Does access to sensitive repository resources require multi-factor sign-in? | Met | GitHub requires two-factor sign-in for contributors and protects sensitive settings and credentials. Public source remains intentionally readable. |
| `OSPS-AC-02.01` — Are new collaborators assigned the lowest privileges by default or granted access manually? | Met | External contributors have no direct rights and propose changes through forks and pull requests. Repository access is granted explicitly. |
| `OSPS-AC-03.01` — Are direct commits to the primary branch prevented? | Met | The protected `main` branch accepts changes through pull requests. |
| `OSPS-AC-03.02` — Is deletion of the primary branch protected by an explicit control? | Met | GitHub protection prevents deletion and force pushes to `main`. |
| `OSPS-BR-01.01` — Is untrusted CI metadata validated or safely handled before use? | Met | Workflows do not evaluate contributor-controlled titles, messages or metadata as commands. Shell variables are quoted and permissions are constrained. |
| `OSPS-BR-01.03` — Is untrusted code kept away from privileged CI credentials and assets? | Met | Pull-request analysis uses `pull_request`, not `pull_request_target`; workflows declare permissions and checkouts disable persisted credentials. |
| `OSPS-BR-03.01` — Do official project channels use encrypted transport? | Met | Repository, documentation, support and security links use HTTPS. |
| `OSPS-BR-03.02` — Are distribution channels protected against adversary-in-the-middle attacks? | Met | GitHub distributes source and releases over HTTPS; release assets receive GitHub build attestations. |
| `OSPS-BR-07.01` — Does the project prevent accidental storage of unencrypted secrets in version control? | Met | `.gitignore`, contributor policy, full-history Gitleaks scanning and a validated Gitleaks configuration provide layered controls. |
| `OSPS-DO-01.01` — Do releases have guides for basic functionality? | Met | [User and operator guides](../getting-started/what-is-capacitylens.md) cover setup, use, sign-in, self-hosting and recovery. |
| `OSPS-DO-02.01` — Is defect reporting documented? | Met | [`CONTRIBUTING.md`](https://github.com/Kevinjohn/capacitylens/blob/main/CONTRIBUTING.md) directs ordinary reports to GitHub issues; [`SECURITY.md`](https://github.com/Kevinjohn/capacitylens/blob/main/SECURITY.md) covers vulnerabilities. |
| `OSPS-GV-02.01` — Is there a public mechanism to discuss changes and usage problems? | Met | [Issues](https://github.com/Kevinjohn/capacitylens/issues) and [pull requests](https://github.com/Kevinjohn/capacitylens/pulls) are public, searchable and linkable. |
| `OSPS-GV-03.01` — Is the contribution process documented? | Met | `CONTRIBUTING.md` covers setup, checks, standards, pull requests and sign-off. |
| `OSPS-LE-02.01` — Does the source licence meet the OSI or FSF definition? | Met | `AGPL-3.0-only` is an OSI-approved free-software licence. |
| `OSPS-LE-02.02` — Do released software assets use an OSI- or FSF-compliant licence? | Met | Released software uses `AGPL-3.0-only`; product names and logos have a separate trademark policy. |
| `OSPS-LE-03.01` — Is the source licence stored in a standard repository location? | Met | The complete licence is in the root `LICENSE` file. |
| `OSPS-LE-03.02` — Is the licence included with released source or alongside release assets? | Met | GitHub source releases contain the root `LICENSE` file. |
| `OSPS-QA-01.01` — Is the authoritative repository publicly readable at a stable URL? | Met | The [GitHub repository](https://github.com/Kevinjohn/capacitylens) is public and authoritative. |
| `OSPS-QA-01.02` — Does version control publicly record changes, authors and dates? | Met | The public Git history records content, authorship and timestamps. |
| `OSPS-QA-02.01` — Does the repository list its direct language dependencies? | Met | Workspace `package.json` files declare direct dependencies and `pnpm-lock.yaml` resolves the complete graph. |
| `OSPS-QA-04.01` — Are all constituent repositories documented when the project uses several? | N/A | CapacityLens is a single repository containing the application, shared package, server, documentation and deployment configuration. |
| `OSPS-QA-05.01` — Does version control exclude generated executable artifacts? | Met | Builds and executable application artifacts are generated by CI. Committed `docs/` files are reviewable static documentation, not executable binaries. |
| `OSPS-QA-05.02` — Does version control exclude unreviewable binary artifacts? | Met | No compiled libraries or application executables are committed. Images are documentation and interface assets, which this control excludes. |
| `OSPS-VM-02.01` — Does the documentation identify a security reporting contact or route? | Met | `SECURITY.md` links directly to GitHub Private Vulnerability Reporting and defines a safe fallback. |

## Baseline Level 2

| Control and question | Answer | Evidence or reason |
| --- | --- | --- |
| `OSPS-AC-04.01` — Do CI jobs without explicit permissions receive least privilege by default? | Met | Workflows set top-level read-only permissions and elevate individual jobs only where required. |
| `OSPS-BR-02.01` — Does every official release have a unique identifier? | Met | Releases use Semantic Versioning tags, including explicit prerelease identifiers. |
| `OSPS-BR-04.01` — Does every release describe functional and security changes? | Met | GitHub release notes and [`CHANGELOG.md`](https://github.com/Kevinjohn/capacitylens/blob/main/CHANGELOG.md) provide human-readable changes and security entries. |
| `OSPS-BR-05.01` — Does the build use standard tooling to obtain dependencies? | Met | pnpm reads the workspace manifests and exact lockfile. |
| `OSPS-BR-06.01` — Are release assets signed or represented in a signed manifest containing hashes? | Met | The release workflow creates GitHub build attestations and publishes an in-toto provenance bundle for the packaged build and SPDX SBOM. |
| `OSPS-DO-06.01` — Is dependency selection, retrieval and tracking documented? | Met | The [development guide](../reference/development.md#ci-jobs) documents dependency policy, pnpm, the lockfile, Dependabot and validation. |
| `OSPS-DO-07.01` — Are build instructions and prerequisites documented? | Met | The README and `CONTRIBUTING.md` specify Node 24, pnpm, installation, development and complete validation commands. |
| `OSPS-GV-01.01` — Are members with access to sensitive resources listed? | Met | [`GOVERNANCE.md`](https://github.com/Kevinjohn/capacitylens/blob/main/GOVERNANCE.md) records the maintainer-led model; the repository owner is publicly identified through GitHub and package metadata. |
| `OSPS-GV-01.02` — Are project roles and responsibilities documented? | Met | `GOVERNANCE.md` describes product direction, review, release, security response and contributor progression. |
| `OSPS-GV-03.02` — Does the contributor guide define acceptable contributions? | Met | `CONTRIBUTING.md` defines scope, coding, testing, security, submission and DCO requirements. |
| `OSPS-LE-01.01` — Must contributors assert legal authority for every commit? | Met | Contributor commits require DCO sign-off, documented in `CONTRIBUTING.md` and checked by CI. |
| `OSPS-QA-03.01` — Must automated status checks pass or be explicitly bypassed before `main` accepts a commit? | Unmet | Current branch protection requires pull requests but deliberately does not require status checks while there is one active maintainer. Full workflows report after merge. |
| `OSPS-QA-06.01` — Does CI run an automated test suite before every commit is accepted? | Unmet | Contributors run the complete local gates and CodeQL analyzes pull requests, but application and browser suites currently report after merge rather than blocking every merge. |
| `OSPS-SA-01.01` — Does design documentation describe system actors and actions? | Met | The [account-boundary design](https://github.com/Kevinjohn/capacitylens/blob/main/docs-src/account-boundary.md), [threat model](threat-model.md) and development reference describe people, trust boundaries, components and operations. |
| `OSPS-SA-02.01` — Are the released software's external interfaces documented? | Met | Self-hosting, sign-in, account-boundary and development references describe browser, HTTP, configuration, identity-provider and persistence interfaces. |
| `OSPS-SA-03.01` — Has the project performed a security assessment? | Met | The [dated security review](security-review-2026-08-18.md), ASVS ledger, threat model and control inventories identify likely and high-impact risks. |
| `OSPS-VM-01.01` — Is there a coordinated-disclosure policy with a response timeframe? | Met | `SECURITY.md` requests private reports, targets acknowledgement within five working days and explains validation, repair and advisory publication. |
| `OSPS-VM-03.01` — Can reporters contact the project privately about vulnerabilities? | Met | GitHub Private Vulnerability Reporting is the primary documented route. |
| `OSPS-VM-04.01` — Will discovered vulnerabilities be published publicly? | Met | `SECURITY.md` commits to publishing an advisory after a patched release; release notes and the changelog record relevant fixes. |

Level 2 is not currently claimable because `OSPS-QA-03.01` and `OSPS-QA-06.01` remain unmet.

## Baseline Level 3

| Control and question | Answer | Evidence or reason |
| --- | --- | --- |
| `OSPS-AC-04.02` — Does each CI job receive only the permissions it needs? | Met | Workflows declare minimal permissions; write, attestation and identity-token rights are limited to the release job that consumes them. |
| `OSPS-BR-01.04` — Is trusted collaborator input sanitized before CI uses it? | Met | Manual release input is treated as an existing tag, passed as a quoted value and resolved by GitHub checkout rather than evaluated as shell code. |
| `OSPS-BR-02.02` — Is every release asset associated with a unique release identifier? | Met | Assets attach to a uniquely tagged GitHub release and their provenance subjects contain cryptographic identities. |
| `OSPS-BR-07.02` — Is there a policy for storing, accessing and rotating secrets? | Met | Security inventories, self-hosting configuration and incident guidance define storage boundaries, access expectations and rotation steps. |
| `OSPS-DO-03.01` — Are there user instructions for verifying release integrity and authenticity? | Unmet | Attestations are generated, but the public documentation does not yet give consumers a complete verification command and expected result. |
| `OSPS-DO-03.02` — Do verification instructions identify the expected release author or process? | Unmet | The release workflow has a GitHub identity, but consumer-facing verification documentation does not yet pin and explain the expected identity. |
| `OSPS-DO-04.01` — Is each release's support scope and duration documented? | Met | `SECURITY.md` states that only the latest release and current `main` are supported; `SUPPORT.md` defines the available support routes. |
| `OSPS-DO-05.01` — Does documentation say when releases stop receiving security updates? | Met | `SECURITY.md` states that older releases may not receive fixes once superseded. |
| `OSPS-GV-04.01` — Must collaborators be reviewed before receiving escalated access? | Unmet | The governance document describes progression but does not define an enforceable vetting and approval policy for sensitive access. |
| `OSPS-QA-02.02` — Are compiled release assets delivered with an SBOM? | Met | The release workflow publishes an SPDX JSON SBOM alongside the packaged web build and provenance bundle. |
| `OSPS-QA-04.02` — Do all repositories in a multi-repository release enforce equivalent security requirements? | N/A | CapacityLens releases are built from one repository. |
| `OSPS-QA-06.02` — Is it documented when and how tests run? | Met | `CONTRIBUTING.md` and the development guide describe local commands, CI jobs, coverage expectations and affected-risk checks. |
| `OSPS-QA-06.03` — Must major changes add or update automated tests? | Met | `CONTRIBUTING.md` requires tests that fail without a behavior change and names extra threat-oriented suites for sensitive changes. |
| `OSPS-QA-07.01` — Does every change require approval from a human other than its author? | Unmet | CapacityLens currently has one active maintainer and branch protection deliberately requires no non-author approval. |
| `OSPS-SA-03.02` — Has the project performed threat modelling and attack-surface analysis? | Met | The [threat model](threat-model.md), attack inventory, ASVS ledger and dated reviews cover trust boundaries, critical paths, threats and mitigations. |
| `OSPS-VM-04.02` — Are non-exploitable component findings accounted for in VEX documents? | Unmet | The project produces SBOMs and reviews dependency findings but does not publish a VEX feed. |
| `OSPS-VM-05.01` — Is there a documented remediation threshold for dependency and licence findings? | Unmet | CI has audit and vulnerability thresholds, but one public policy does not yet define both vulnerability and licence remediation thresholds. |
| `OSPS-VM-05.02` — Must applicable composition-analysis violations be resolved before release? | Unmet | Security scans run on `main` and on demand, but the release workflow does not enforce a documented SCA decision gate before publication. |
| `OSPS-VM-05.03` — Is every change automatically checked against dependency policy and blocked on violations? | Unmet | Dependency checks are not currently a required pre-merge status on every change. |
| `OSPS-VM-06.01` — Is there a documented remediation threshold for static-analysis findings? | Unmet | CodeQL runs on every pull request, but the public policy does not yet define severity and remediation-time thresholds. |
| `OSPS-VM-06.02` — Is every change statically analyzed and blocked on unsuppressed security violations? | Unmet | CodeQL analyzes each pull request, but its result is not currently a required branch-protection check. |

Level 3 is not currently claimable. The unmet controls above are the executable improvement queue;
they should only be changed to **Met** after the policy, enforcement and consumer evidence land.

## Keep the record current

Review this page whenever branch protection, release publication, security policy or CI behavior
changes. Update the public BadgeApp answers separately: repository documentation is evidence, not a
substitute for the public self-certification.

The control summaries are derived from the OpenSSF Best Practices Badge Baseline criteria and are
published here with attribution to David A. Wheeler and the OpenSSF Best Practices Badge
contributors under the Community Data License Agreement – Permissive 2.0.
