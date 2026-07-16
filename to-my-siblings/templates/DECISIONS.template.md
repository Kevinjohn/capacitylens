# Standing decisions

This is the short, present-tense record of decisions that constrain future work. History belongs in
the changelog or linked issues.

## Product

- [One job, audience and granularity.]
- [Explicit non-goals.]
- [Canonical nouns and visible vocabulary.]
- [Mobile posture.]

## Domain invariants

- [Equality/range/default rule.]
- [Relationship/discriminated-kind rule.]
- [Lifecycle/cascade rule.]
- [Privacy-sensitive field rule.]

## Data and tenancy

- Server-backed SQLite is authoritative.
- The demo is explicit, in-memory and resets.
- Every scoped entity carries `accountId`; selected account state is transient.
- Session membership is the security boundary; client scoping is defense in depth.
- Forms reject invalid input; import/server repair only safe, tested cases.
- Multi-row replacements are atomic.
- Portable export and physical SQLite versions are independent. SQLite uses immutable ordered
  migrations plus a checksummed database-side history ledger.
- New builds upgrade older files; older builds refuse newer files. Rollback restores the verified
  pre-migration snapshot and runs its matching image; there are no down migrations.

## Offline

- [Off entirely, or explicit expiring read-only posture.]
- No queued offline writes unless a future decision defines conflict semantics.

## Authentication and security

- [Auth modes and stable/experimental provider posture.]
- [Registration/invitation/first-owner rule.]
- [Role hierarchy and field-level visibility.]
- Production refuses unsafe auth/configuration.
- Errors on data paths are surfaced.

## Design and accessibility

- [Semantic colour roles.]
- [Canonical UK/other language rules.]
- [WCAG/test baseline.]
- [Theme/device preference scope.]

## Self-hosting and operations

- [Supported topology.]
- [Backup/restore/health posture.]
- SQLite upgrades use coordinated single-server restarts, not mixed-version writers.
- Schema-bearing releases are rehearsed against released fixtures and an anonymised representative
  installation, including disk-exhaustion and forced-termination recovery.

## Open source and hosted service

- [Licence.]
- Community application remains independently useful.
- Hosted-only billing/provisioning/operations live outside the community core.
- [Contribution/governance/trademark boundary.]

## Continuous integration

- [Local source of truth.]
- [Private/public runner policy.]
- [Release-version CI policy.]
