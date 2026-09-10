---
title: Review the Node 26 discovery
description: Evidence, proposed runtime minimums and remaining acceptance checks for Node 24 and Node 26 support.
---

# Review the Node 26 discovery

This reference preserves the findings for contributors assessing [issue #710](https://github.com/Kevinjohn/capacitylens/issues/710). It records the investigation as of 11 September 2026 and the candidate in [draft PR #779](https://github.com/Kevinjohn/capacitylens/pull/779). It is evidence for a future support decision, not a release announcement.

## Decision and release boundary

Node 24 remains the development, build and release baseline. The proposal is one codebase supporting Node 24 and Node 26 with separate minimum versions:

| Major | Proposed minimum | Reason and acceptance condition |
| --- | --- | --- |
| 24 | 24.19.0 | Verified baseline. The investigation did not establish whether an earlier version is sufficient. |
| 26 | 26.9.0, conditional | The official release must contain the SQLite callback-scope fix and pass native Linux/macOS probes and complete compatibility validation. Otherwise use the first later official release that does. |

At the last release check, 26.8.2 was the latest published Node 26 release and still contained the defect. The [26.9.0 release proposal](https://github.com/nodejs/node/pull/65881) was open and draft. Its inspected head, `b37bb627f5d2b70096f6dc75d4c5ac9cfe3662fd`, contained the backport (`113180ad3f`); this is not evidence that an official fixed release has shipped. Both the inspected official 26.8.2 source and then-current v26.x source lacked the fix.

The intended policy is to test the minimum and latest patch of each supported major, recommend current patches, and raise floors when security or correctness requires it. The existing `>=24` package engines and major-only server preflight do **not** enforce these proposed floors or restrict support to two majors. The candidate setup override accepts numeric majors only; exact-minimum selection and a minimum/latest matrix remain implementation work.

Long-term support remains bounded by upstream maintenance. The [Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json), as checked during discovery, gives Node 24 an end date of 30 April 2028 and Node 26 an LTS start of 28 October 2026 and end date of 30 April 2029.

PR #779 remains draft and unmerged. Its manual/weekly compatibility workflow is prepared but inactive. Discovery does not authorise merging, activating that schedule, deploying, releasing, changing the default runtime, or distributing an experimental patched Node binary.

## Correct the initial diagnosis

The first official Node 26.8.2 application run had 3,987 passing tests and eight failures. The first server run had 1,868 passing tests and 11 failures. These were different problems:

| Finding | Final interpretation |
| --- | --- |
| Eight application failures | Test storage objects and prototypes disagreed under Node 26/jsdom, so spies missed quota/error injection. |
| Nine backup-related server failures | Node SQLite completed native work but could delay JavaScript completion until another callback ran. |
| One TLS failure | PATH selected macOS LibreSSL, which lacked `-copy_extensions`; OpenSSL 3.6.4 passed the 17 focused tests. No certificate-code fix was needed. |
| One restore timeout | Passed in isolation; an independent restore defect was not established. |

“Node 26 backups always hang” was an incorrect early generalisation. No-timer probes and normal packaged startup/periodic backups succeeded. The reproducible defect depends on the event-loop arrangement. No corrupted snapshots were observed; that does not prove every backup workload is safe.

Initial frontend builds, 264 Chromium tests, account/credential/migration checks, a v7-to-v38 rehearsal, package deployment into scratch space and an import smoke also passed. Those successes did not make the unchanged application or server gate green.

## Reproduce the native backup defect

The same 18-case matrix ran on native Linux x64 and macOS arm64. Six source/destination combinations covered in-memory, rollback-journal and WAL sources, each with a new or empty pre-created destination. Children had an eight-second parent deadline and were terminated before cleanup. Completed snapshots were reopened for row and integrity checks.

| Runtime, on each platform | No timer | Referenced 60-second timer | 10 ms interval |
| --- | --- | --- | --- |
| 24.19.0 | 6/6 | 6/6 | 6/6 |
| 26.8.1 | 6/6 | 0/6 within deadline | 6/6 |
| 26.8.2 | 6/6 | 0/6 within deadline | 6/6 |

The [no-timer Linux run](https://github.com/Kevinjohn/capacitylens/actions/runs/34518249150) used commit `8c17a47cc0ab5565435f472b7dda6d5844c9359a`. The [expanded Linux run](https://github.com/Kevinjohn/capacitylens/actions/runs/34518443811) used `2491e34915e31c458a7416014e03bf486430ced2`; its two Node 26 jobs failed as expected. The [probe at that exact commit](https://github.com/Kevinjohn/capacitylens/blob/2491e34915e31c458a7416014e03bf486430ced2/investigation/sqlite-backup-probe.mjs) preserves the executable reproduction. The diagnostic branch is not a merge candidate.

A further nine-case macOS matrix used 300 rows, positive `rate: 1`, fresh, empty pre-created and valid existing destinations, hashes and reopened integrity checks. It passed without the problematic timer on 24.19.0, 26.8.1 and 26.8.2. Timing probes with 100 ms, one-, two- and five-second referenced timers showed completion following the timer. An unreferenced future timer allowed prompt completion. Node 26.7.0 showed the same pattern; the first affected Node version was not bisected.

Stock Node 24.19.0 and 26.8.2 both passed packaged startup and periodic backup checks: import a changed resource, leave the server without HTTP traffic for 65 seconds, verify a later snapshot contains the changed row and passes integrity, then shut down cleanly. The application's periodic timer is unreferenced. These results cover an ordinary operating path, not every arrangement of other timers, concurrent writes, sustained retention, recovery or shutdown during the reproduced delay.

## Explain and verify the upstream fix

`async_hooks` tracing separated native Promise resolution from its JavaScript continuation. On stock 26.8.2, resolution happened around 1.186 ms, but `await` resumed around 1,002.907 ms after the timer at 1,002.624 ms. Node 24 resolved around 0.876 ms and resumed around 0.896 ms. Rejection after a throwing progress callback showed the same delay.

File-read and PBKDF2 controls, plus several caller arrangements, isolated the behaviour to this completion path. A standalone native `uv_queue_work` module without SQLite reproduced it: a bare Node 26 callback took about 502.760 ms to deliver the continuation with a 500 ms timer; adding `node::CallbackScope` reduced that to about 0.0905 ms. Corresponding Node 24 results were 0.336 ms and 0.139 ms. These timings are individual diagnostic observations, not performance benchmarks.

[Node PR #65666](https://github.com/nodejs/node/pull/65666), merged on 2 September, fixes the missing scope in `BackupJob::AfterThreadPoolWork` in `src/node_sqlite.cc`. Exact commit: [`6e7818e4f6d2d0429a2ebd441868af19bf7333d2`](https://github.com/nodejs/node/commit/6e7818e4f6d2d0429a2ebd441868af19bf7333d2). It adds context and internal callback scopes around the completion function, covering both resolution and rejection. A duplicate upstream report is unnecessary; the earlier report draft is superseded.

The upstream regression fixture makes backup the final active request: it copies a 1 MiB blob with rate one, clears its heartbeat from the progress callback, and asserts at `beforeExit` that completion ran. The fixture is `test/fixtures/sqlite/backup-last-request.mjs`; the enclosing suite is `test/parallel/test-sqlite-backup.mjs`.

### Controlled source comparison

The official 26.8.2 source was configured with `./configure --without-npm` and built with `make -j4`. The baseline binary was retained, then the exact three-file upstream patch was applied and rebuilt with the same source base and compiler. Nothing was installed as the machine default. The patched executable still identifies itself as 26.8.2; it is not an official 26.9.0 build.

| Check | Baseline source build | Exact patched source build |
| --- | --- | --- |
| Upstream last-request fixture | Failed | Passed |
| 18-case timer matrix | Six failures | 18/18 passed |
| Success trace | Native 0.777 ms; continuation 1,003.239 ms | Native 0.8345 ms; continuation 0.8511 ms, before timer |
| Rejection trace | 502.952 ms | 0.3862 ms, before timer |
| Full upstream SQLite backup suite | Not used as a baseline acceptance claim | 18/18 passed |

Preserved SHA-256 identifiers:

| Artifact | SHA-256 |
| --- | --- |
| Official 26.8.2 source `.tar.xz` | `36b37bf5ee4d092b9d9dff2d1a90b1444f8b453eddf6ff96cabdebb97d32f41d` |
| Baseline compiled executable | `725c171df50b188063f13acb8a23fc40425431fc95e4c98f6985eb7007c43030` |
| Patched compiled executable | `a815a34351bf28c4655ebffa07c4a8eb3da984496dd2e0e2262cc566b606635e` |
| Baseline `node_sqlite.cc` | `ef9821838ee1eed603cd84f63a04e5a88dbe5dca625173e6dad556349f92aaff` |
| Patched `node_sqlite.cc` | `f844c3245159f7e64ffd7046dc12fd0ca27d79f60c3309300a61c090df814961` |
| Saved upstream patch | `377a85407d95480eba399f11ae3e483b03d6f41986cda378df1bc6ff76f5842f` |
| Official 26.8.2 macOS ARM64 archive | `974b6d5fb2fc7c33ff2354db0902b4e91c2de01ec8acc6de48e543c97e18c9e1` |

On CapacityLens base `37ee79fe40754554c3d09275293539e185b56f0f`, the patched runtime passed the server gate (1,879 coverage tests, 56 account tests, three durability tests and three migration tests), packaged periodic smoke and v7-to-v38 rehearsal. The rehearsal covered 17 tables and 46 rows, value preservation, rollback, ENOSPC, termination and idempotence. Chromium had 262 first-attempt passes and two draw-mode setup failures that passed on retry; their cause remains unproven.

## Fix the test storage mismatch

Node 26's native storage globals interacted with jsdom and the existing fallback. The local store could be `MemoryStorage` while the session store used a different prototype from the intercepted `Storage.prototype`. Global/window object identity alone therefore did not establish compatible storage. Eight tests missed their intended quota/error injections.

Passing `--localstorage-file` removed a warning but left all eight failures. Assigning the jsdom prototype to the fallback object caused `Illegal invocation`. A scratch setup with two independent memory stores and a matching constructor passed 82 focused tests on both runtimes and then all 3,995 application tests on Node 26; that scratch test run was not a full gate.

The maintained candidate in `src/test/setup.ts` aligns the constructor, prototypes and window/global aliases, using independent stores when storage is missing, unusable or mismatched. Reading a storage getter suppresses only the expected `DOMException` named `SecurityError` for an opaque origin. The normal Node 24 path remains intact. `src/test/storageCompatibility.test.ts` checks aliases, independence and prototype-based failure injection. The focused maintained suite passed 83/83 on both runtimes; the complete maintained application suite passed 3,996/3,996. This is test-environment compatibility work and does not change product persistence.

## Record the candidate and validation accurately

The implementation milestone is [`c87660b920f75a29ab0e0cfef822fc274fb78efa`](https://github.com/Kevinjohn/capacitylens/commit/c87660b920f75a29ab0e0cfef822fc274fb78efa). Later documentation commits preserve this evidence without rerunning unrelated application suites.

The candidate prepares four separate Linux compatibility jobs: application gate, server gate with rehearsal, packaged smoke and Chromium. It uses pinned actions, read-only permissions, timeouts, concurrency control and failure artifacts. Existing workflows still select `.nvmrc`. The setup action checks the selected major, pnpm 11.4.0 and frozen installation.

The maintained packaged smoke checks the deployed server and import worker, startup and later periodic snapshots, changed contents, integrity and shutdown. It isolates inherited application settings, uses temporary fictional data and loopback networking, bounds polling and shutdown, and surfaces early failures. Two harness tests cover environment isolation and an actually failing entrypoint with prompt cleanup.

| Runtime and scope | Recorded result at the implementation milestone |
| --- | --- |
| Official 24.19.0 application gate | Passed; 3,996 tests in 222 files, static checks, coverage, audit and build |
| Official 26.8.2 application gate | Passed; same 3,996 tests using maintained storage setup |
| Official 24.19.0 server gate | Passed; 1,879 coverage, 56 account, three durability and three migration tests |
| Official 24.19.0 Chromium | 264 passed without retries |
| Official 24.19.0 and experimental patched 26 packaged smoke | Startup, periodic content/integrity and shutdown passed |
| Both of those runtimes, smoke harness tests | 2/2 passed |
| Default 24 and override 26 setup version checks | Passed |
| Fresh standalone pnpm 11.4.0 and frozen install on official 26 | Passed |
| Workflow syntax | actionlint 1.7.12 passed |
| Documentation and PR analysis | Documentation build/visual checks and CodeQL passed |
| Existing Node 24 GitHub gate | [Run 34540727802](https://github.com/Kevinjohn/capacitylens/actions/runs/34540727802) passed on `c87660b9` |

The GitHub result covers that gate workflow, not every available CI workflow. Its DCO job was intentionally skipped for manual dispatch; signed commits were checked separately. The new Node 26 workflow itself was not dispatched or activated. Complete server, browser and backup acceptance against an **official fixed Node 26 release remains outstanding**.

### Preserve unsuccessful and invalid runs

An early restricted Vitest run failed to create `.vite-temp`; `--configLoader runner` avoided that environment problem. A scratch setup placed outside the worktree failed discovery before tests; moving it into an ignored local cache allowed the experiment. Neither was an application regression.

A supposed Node 24 server attempt was invalid because Homebrew PATH precedence selected Node 26.8.1. It was stopped and is not counted as Node 24 evidence. The corrected attempt found a documentation-fragment failure (1,878 passing tests); fixing the automatic heading slug passed five focused tests and the later complete gate. Use `node --version` after runtime activation and preserve the selected runtime's PATH precedence.

Node 26 experimental storage warnings remained warnings. Earlier patched-runtime browser flakes remain recorded even though the final Node 24 browser run passed cleanly. Passing application tests on official 26.8.2 does not override the separate native backup failure.

## Reject workarounds and bound the risk

Do not declare 26.8.2 the supported minimum: it retains the demonstrated defect. Rolling back to 26.7 does not solve it. A heartbeat makes the reproduction complete but masks the missing callback scope; longer timeouts also conceal it. Replacing the production backup implementation would introduce separate durability and shutdown risks and was not justified by this discovery.

The unrelated [zero-rate backup issue #64892](https://github.com/nodejs/node/issues/64892) and [fix #64893](https://github.com/nodejs/node/pull/64893) are not this diagnosis: these probes use default or positive rates. No production data, database schema, Node types, build target or default runtime changed. No Docker validation or changes were part of this work.

The return is earlier runtime-regression detection and a tested path to the next maintained major without a second application implementation. Most candidate tooling already exists. The remaining effort depends on the official release and acceptance results; exact minimum enforcement and matrix coverage still need implementation. The main risk is prematurely calling a runtime supported on the strength of frontend checks or an experimental binary. Keeping adoption conditional limits that risk; recurring CI adds maintenance and execution cost.

## Finish acceptance before adoption

1. Inspect the actual official release source and release metadata for #65666; record its exact version and artifact hashes. If 26.9.0 lacks the fix, move the proposed floor forward.
2. Repeat native Linux x64 and macOS ARM64 matrices, including resolution/rejection and the last-active-request regression, with that official binary.
3. Run application and server gates, rehearsal, packaged startup/periodic backup checks and Chromium against the official release. Investigate any failures rather than importing experimental-build results as acceptance.
4. Implement exact minimum/latest selection for both majors. Align package engines, runtime preflight, CI selection and operator documentation with the approved support range. Verify rejection below the floors and handling of other majors.
5. Record results, residual limitations and the support decision in #710 and PR #779. Keep Node 24 as default unless a separate decision changes it.
6. Obtain the explicit go-ahead to merge/activate or release. Documentation preservation does not remove the current hold.

## Locate the preserved evidence

The public record consists of this committed report, the issue/PR history, immutable source/probe links and the linked CI runs. The [milestone comment](https://github.com/Kevinjohn/capacitylens/issues/710#issuecomment-5626734080) and [minimum-version clarification](https://github.com/Kevinjohn/capacitylens/issues/710#issuecomment-5626874401) record the agreed boundaries.

A private durable local archive retains 1,601 available evidence files, including raw logs, reproduction scripts, source archives, the exact patch and both controlled-build executables. Its manifest lists every file's size and SHA-256 and identifies excluded reproducible dependency caches and build trees. Every archived file and the archive digest were verified. The archive SHA-256 is `0250457237e3bdd3a9b1003248c3ffb97ea7f7a0423797996e5042b2912d571e` (457,036,240 bytes). Original scratch files were retained. This is a local copy, not an off-machine backup; raw records require privacy review before external publication.

| Archived record | Purpose |
| --- | --- |
| `investigation.md`, `server-findings.md`, `storage-findings.md` | Initial observations, including subsequently corrected conclusions |
| `phase2-report.md`, `phase2-linux/`, `phase2-macos/` | Native probes, platform matrices and snapshot checks |
| `phase3/report.md` and phase-three traces | Completion mechanism, native controls and before/after evidence |
| `phase3-build/runtime-build-metadata.json` | Source, patch and binary provenance |
| `phase3-build/baseline-node`, patched `out/Release/node` | Actual controlled-build executables; research only |
| `phase4/report.md` and phase-four logs | Maintained candidate checks and saved GitHub gate output |

CI artifacts can expire. Their available local copies and this consolidated report preserve the findings independently of that retention window. Historical scripts contain scratch paths and historical reports contain superseded interpretations; use this report for conclusions and inspect scripts before rerunning them. Current issue/PR snapshots and the final report are stored alongside the archive as supplementary records.

For maintained commands, see [Check Node 26 compatibility](/reference/development#check-node-26-compatibility).
