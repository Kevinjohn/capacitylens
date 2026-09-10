---
title: Choose the release source
description: Pin each hosted installation to deliberate CapacityLens releases without putting private deployment details in the public project.
---

# Choose the release source

This page gives the managed platform a stable branch that changes only when you approve a
CapacityLens release. It prevents ordinary changes to the public project from deploying to a
live installation. Allow about ten minutes when your source-control account is already connected.

## Prerequisites

- Permission to read the public CapacityLens project.
- Permission to create a private project if you want operational separation.
- A published CapacityLens release or an exact commit that you have chosen to run.

## 1. Choose a source pattern

Use one of these patterns.

### A private deployment mirror

This is the recommended pattern when you operate installations for other organisations. The
public project stays entirely generic. A private project contains only CapacityLens history and
neutral deployment branches such as `production-01`.

The private project is not a fork where customer features develop. Do not commit secrets,
customer data, environment files or installation-specific patches to it.

### A pinned branch in the public project

This is simpler, but branch names and activity are public. Use a neutral name and point it at a
released commit. Do not put a customer's name, domain or operational details in the branch.

### A release tag selected directly

Use this only if the platform can deploy a tag manually and will not follow a moving default
branch. Confirm how the platform treats detached commits before relying on this pattern.

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

Connect the managed platform to the source-control account that can read the selected project.
Choose the project and the pinned production branch.

For the private-mirror example, select:

```text
Repository: YOUR-ACCOUNT/capacitylens-hosted
Branch: production-01
```

Do not select `main` unless you deliberately want every change on `main` to become eligible for
deployment.

## 4. Turn automatic deployment off

Disable **Push to deploy**, **Quick deploy**, deployment webhooks or the equivalent platform
setting. Save the setting, reload the page and confirm it remains disabled.

The intended release flow is:

```text
CapacityLens publishes a release
  -> you review its changelog and backup requirements
  -> you advance the pinned production branch
  -> you click Deploy
```

Do not add a scheduled job that pulls the public project automatically. Automation would undo the
release boundary this page creates.

### Use one branch for staged manual promotion

A staging installation and a production installation may select the same private project and the
same pinned branch. They do not need separate Git branches when the release candidate is identical.
The manual **Deploy** actions create the promotion boundary:

```text
advance production-01 to the approved release
  -> click Deploy on staging
  -> complete the staging smoke tests
  -> click Deploy on production
```

Both installations must have automatic deployment disabled. Advancing the branch makes the release
eligible for both sites, but neither site changes until an operator deploys it. Record the deployed
commit for each installation because staging and production may temporarily run different commits.

Use separate branches only when staging must run code that is not yet an approved production
candidate. Do not create an installation-specific branch merely to delay a manual deployment.

## 5. Record the release

Record these values in your private operations notes:

- installation name;
- source project;
- production branch;
- release tag;
- exact commit; and
- date deployed.

Do not put customer names, domains, private project names or access details in the public
CapacityLens project.

## Verify the result

Before continuing, confirm all of the following:

- The platform can see the selected project and branch.
- The branch points at the intended released commit.
- Automatic deployment is disabled.
- Pushing an unrelated public change cannot change the branch selected by the platform.
- No secret or customer-specific configuration exists in source control.

## What's next

Continue to [Create and build the site](create-and-build-the-site.md).
