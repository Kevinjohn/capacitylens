# Governance

CapacityLens is currently a maintainer-led project.

The maintainer sets product direction, reviews pull requests, manages releases and handles the
security response. Decisions are guided by the documented product boundary, user safety,
maintainability and evidence from tests or real use. Discussion is welcome; merge authority remains
with the maintainer while the community is small.

Substantial changes should begin as an issue. A proposal should explain the user problem, why it
fits the deliberate scope, migration and security impact, and the smallest viable implementation.
Accepted architectural constraints are recorded in `DECISIONS.md`.

Contributors who demonstrate sustained, constructive work may be invited to triage issues or review
changes. Any future expansion of maintainer rights and the process for removing them will be
recorded here publicly.

Releases follow Semantic Versioning. Before 1.0, minor versions may contain breaking changes, which
must be called out in `CHANGELOG.md` with migration instructions.

Conflicts of interest—especially changes that benefit a hosted offering at the expense of
self-hosters—should be disclosed. The open-source application remains usable independently; hosted
billing and deployment wrappers are outside this repository.
