# Internal golden-copy generator

Run this only when deliberately creating another SmallSass product:

```sh
node to-my-siblings/reference-kit/scripts/create-sibling.mjs \
  --name "Invoice Nudge" \
  --slug invoice-nudge \
  ../invoice-nudge
```

The target must be absent or empty and outside the CapacityLens checkout. The generator copies the
working reference, removes local/generated/sensitive material, rebrands obvious product identity,
resets product package versions to `0.1.0`, and writes provenance under
`to-my-siblings/smallsass.origin.json`.

It is not a CapacityLens command, dependency or release gate. The generated repository must install
its own dependencies and pass its own product gates.

## Safety properties

- refuses a non-empty target;
- refuses a target inside, equal to or above the source checkout;
- excludes `.git`, `node_modules`, output, coverage, reports and local worktrees;
- excludes real `.env*` files while retaining `.env.example`;
- excludes private keys, certificates, SQLite files, audit files and logs;
- copies no symbolic links;
- performs no Git, install, network or publishing action.

Smoke test after changing the generator:

```sh
node to-my-siblings/reference-kit/scripts/smoke-test-generator.mjs
```
