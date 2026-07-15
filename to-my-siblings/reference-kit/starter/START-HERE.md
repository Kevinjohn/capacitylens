# Starting an internal SmallSass sibling

This checkout began as a rebranded copy of CapacityLens. It is a working reference, not a blank
starter and not proof that the new product is ready.

CapacityLens scheduling code remains example code until deliberately replaced. Keep the repository
deployable while converting one vertical slice at a time.

## First session

1. Read `to-my-siblings/00-sibling-contract.md`,
   `to-my-siblings/14-new-sibling-playbook.md` and
   `to-my-siblings/17-executable-family-platform.md`.
2. Write the product's one-sentence promise, user, non-goals and first end-to-end workflow.
3. Review `to-my-siblings/smallsass.origin.json` so you know which reference created the copy.
4. Use the reference map to separate family-shaped infrastructure from scheduler-specific domain
   code.
5. Replace one complete slice at a time: shared type → fixture → SQLite column → sanitisation →
   authorization → API → state → UI → browser test.
6. Search for every remaining CapacityLens name, scheduling noun, environment variable, storage key,
   route, seed and test id. Review each result; do not blindly replace migration history.
7. Run `pnpm run gate`, `pnpm run gate:server` and `pnpm run e2e` before release.

## Already-decided defaults

The handbook recommends the account envelope, role hierarchy, Better Auth posture, SQLite
self-hosting baseline, semantic colours, responsive philosophy, defensive error handling, no queued
offline writes and operator-documentation set.

They are internal defaults, not immutable public APIs. Record a deliberate exception when the new
product has a real reason to differ.

## Removal rule

Remove CapacityLens domain behaviour only after its replacement slice passes. Keeping a runnable
system throughout conversion is safer than tearing the repository down and recreating integration
seams from memory.
