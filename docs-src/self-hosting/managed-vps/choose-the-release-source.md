---
title: Choose the release source
description: Pin each hosted installation to deliberate CapacityLens releases without putting private deployment details in the public project.
---

# Choose the release source

Long-form route: building from a source checkout. To install from the release archive with
nothing to build, follow the [five steps](/self-hosting/managed-vps/) instead.

Give the platform a branch that changes only when you approve a release, so ordinary changes to
the public project never deploy to a live installation. About ten minutes when your
source-control account is already connected.

## Prerequisites

- Permission to read the public CapacityLens project.
- Permission to create and write to a private project if you want operational separation.
- For a pinned branch in the public project, permission to create and advance it. The platform
  only needs read access to the selected project.
- A published CapacityLens release or an exact commit that you have chosen to run.

## 1. Choose a source pattern

### A private deployment mirror

Recommended when you operate installations for other organisations. The public project stays
generic; a private project holds only CapacityLens history and neutral deployment branches such
as `production-01`. It is not a fork for customer features: never commit secrets, customer data,
environment files or installation-specific patches to it.

Whoever promotes a release needs write access to advance `production-01`. Give the platform a
separate read-only connection where it supports one.

### A pinned branch in the public project

Simpler, but branch names and activity are public. Use a neutral name pointing at a released
commit, with no customer name, domain or operational detail. The operator needs write access to
create and advance it; the platform only needs read access.

### A release tag selected directly

Only if the platform can deploy a tag manually and will not follow a moving default branch.
Confirm how it treats detached commits first.

## 2. Create a private mirror

Skip this step if you selected another pattern. Create an empty private project, then add it as a
second remote from a trusted CapacityLens checkout:

```bash
git remote add hosted git@github.com:YOUR-ACCOUNT/capacitylens-hosted.git
```

Fetch the public release tags:

```bash
git fetch origin --tags
```

Create a neutral branch at the release you intend to deploy:

```bash
git switch -c production-01 vX.Y.Z
```

Push that branch to the private project:

```bash
git push -u hosted production-01
```

Open the private project in your source-control service and confirm:

- its visibility is **Private**;
- `production-01` points at the intended release commit; and
- there is no `.env` file or installation-specific change in the project.

## 3. Connect the platform

Connect the platform to the source-control account that can read the project, and choose the
project and pinned branch. For the private mirror:

```text
Repository: YOUR-ACCOUNT/capacitylens-hosted
Branch: production-01
```

Do not select `main` unless you want every change on it to become deployable.

## 4. Turn automatic deployment off

Disable **Push to deploy**, **Quick deploy**, deployment webhooks or the equivalent platform
setting. Save the setting, reload the page and confirm it remains disabled.

The release flow is then:

```text
CapacityLens publishes a release
  -> you review its changelog and backup requirements
  -> you advance the pinned production branch
  -> you click Deploy
```

Do not add a scheduled job that pulls the public project: it would undo this release boundary.

### Use one branch for staged manual promotion

Staging and production can select the same project and pinned branch; the manual **Deploy**
actions are the promotion boundary:

```text
advance production-01 to the approved release
  -> click Deploy on staging
  -> complete the staging smoke tests
  -> click Deploy on production
```

Both must have automatic deployment disabled; neither changes until an operator deploys.
Record each installation's deployed commit, because they may temporarily differ. Use separate
branches only when staging must run code that is not yet an approved production candidate.

## 5. Record the release

In your private operations notes, record:

- installation name;
- source project;
- production branch;
- release tag;
- exact commit; and
- date deployed.

Keep customer names, domains, private project names and access details out of the public
project.

## Verify the result

Confirm:

- The platform can see the selected project and branch.
- The branch points at the intended released commit.
- Automatic deployment is disabled.
- Pushing an unrelated public change cannot change the branch selected by the platform.
- No secret or customer-specific configuration exists in source control.

Next: [Create and build the site](/self-hosting/managed-vps/create-and-build-the-site).
