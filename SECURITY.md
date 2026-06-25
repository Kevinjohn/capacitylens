# Security Policy

CapacityLens is a small, local-first open-source project (AGPL-3.0). We take
security seriously and appreciate reports made responsibly.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting.** In this repository go to the
**Security** tab and choose **Report a vulnerability**. This opens a private
security advisory visible only to the maintainers and you — the right place for
anything sensitive.

Please **do not** open a public issue for a security problem, and please **do
not** email us: this project keeps no email infrastructure by design (it is
privacy-first). There is no inbox to reach.

If private vulnerability reporting is unavailable to you, open a minimal public
issue titled **"security contact request"** with **no** vulnerability details,
so a maintainer can open a private advisory and continue there. Never disclose
the details publicly.

## What to include

To help us reproduce and assess quickly, please include:

- the affected version or commit (see `CHANGELOG.md` / `git rev-parse HEAD`),
- clear steps to reproduce,
- the impact you believe it has,
- any proof-of-concept, if you have one.

## What to expect

- **Acknowledgement.** This is a small project run on a best-effort basis; we
  aim to acknowledge a report within a few days. Thank you for your patience.
- **Coordinated disclosure.** We will work on a fix first, then publish a public
  advisory once a fix is available. If you would like credit, we are glad to
  name you in the advisory.
- **No bug bounty.** There is no monetary reward or bounty program. Reports are
  welcomed purely on a goodwill basis.

## Supported versions

Only the latest released version and the current `main` branch are supported.
Older versions do not receive security fixes.

| Version            | Supported |
| ------------------ | --------- |
| latest release     | yes       |
| `main` (unreleased)| yes       |
| anything older     | no        |

## Scope

This policy covers the CapacityLens source code in this repository. If you run
your own instance — including the optional SQLite-backed server — you are
responsible for securing your own deployment, configuration, and secrets. Issues
specific to a self-hosted deployment (rather than the code here) are outside this
policy's scope.
