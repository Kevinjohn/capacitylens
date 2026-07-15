# Future shared-package migrations

There is no released SmallSass kit today. Files under `reference-kit/packages/` are internal
snapshots and do not participate in CapacityLens's workspace, build or release.

Use this directory only after a package has:

1. at least two real product consumers;
2. an independent repository or release boundary;
3. a documented API owner;
4. semantic versioning;
5. upgrade and rollback instructions for every consumer;
6. product-independent tests.

At that point, add one migration note per released version. Until then, update a snapshot's source
reference and review it manually; do not imply that copying a newer file is a coordinated package
upgrade.
