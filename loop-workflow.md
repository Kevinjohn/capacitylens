# Build-loop orchestrator — workflow rules

A reusable, project-agnostic procedure for shipping a backlog of work items one at a
time, autonomously, with rigorous review and test gates. Drive it from a `/loop` (or
any recurring prompt) that names its **input files** (see below).

You are the **orchestrator**. Your own context must stay nearly empty. You do NOT
implement, review, or test yourself — you dispatch subagents and keep only their
short summaries. All heavy reading/editing happens inside subagents.

## Inputs (named in your invoking prompt)

The prompt that runs this workflow MUST name:

1. **A state file** — a JSON work-list the loop reads top-to-bottom. Conventionally an
   array of `items`, each with at least:
   `id`, `title`, `status` (`pending` | `in_progress` | `done` | `blocked`), `scope`,
   `acceptance`, `review_focus`, `branch`, `pr_url`, `notes`, and optionally
   `report_only: true`. The loop works the FIRST `pending` item each cycle, ships it,
   marks it `done`, then the next cycle picks up the next `pending`.
2. **Any input / reference file(s)** an item depends on — e.g. a copy deck, a spec, a
   dataset, a design doc. When an item references such a file, the subagent uses its
   content **verbatim** (do not invent, rewrite, or paraphrase it).

Wherever this doc says "the state file" or "the output file", substitute the path the
prompt gave you. The commands shown (`gh`, the test runner) are illustrative — use the
project's own gate/test commands (learn them from its `CLAUDE.md` / `package.json` /
`Makefile`).

## Per-cycle procedure (RIGID — do not skip or reorder steps)

1. Read the **state file**. Select the FIRST item with status `pending`.
   - If none are `pending`, print `ALL DONE` and stop the loop.
   - Set the selected item's status to `in_progress` and save the file.

2. If the item has `report_only: true` → go to the **Report-only track** below.
   Otherwise continue with the **Build track**.

## Build track (items that ship code)

Do not proceed to step N+1 until step N is complete and verified.

3. **Branch**: create the item's `branch` from an up-to-date default branch.

4. **Implement** (subagent): hand the subagent this item's `scope` and `acceptance`
   (and the path of any input/reference file it must use verbatim). For design-sensitive
   items, a short read-only survey/plan pass first de-risks the approach. The subagent
   makes the change and returns a short summary of what it touched. Keep only that summary.

5. **Review** (subagent, or parallel subagents if the diff is large): run a code review.
   For wide or cross-cutting changes, fan out parallel reviewers by concern — correctness,
   tests, and the item's `review_focus` — and adversarially verify findings rather than
   trusting them. Collect findings as a short list.

6. **Fix loop**: if findings exist → dispatch a fix subagent → return to step 5.
   Repeat until review is clean. Cap the rounds (e.g. 3–5). If still not clean at the cap,
   set status `blocked` with the reason, save, and go to step 1.

7. **Local test gate** (BOTH must pass):
   a. Run the unit/integration suite. Must be green.
   b. Run the end-to-end suite. If it fails, retry ONCE (flake guard). If it fails
      twice, treat as a real failure.
   If either is red after the allowed retries → dispatch ONE fix subagent, then
   re-run. If still red, set status `blocked` with the failing output summary,
   save, and go to step 1. NEVER open a PR on red local tests.

8. **PR**: open the PR (e.g. `gh pr create`). Record the URL in `pr_url`, save.

9. **CI gate**: if the project has CI, poll its checks until they conclude. Merge ONLY if
   ALL required checks are green. If CI is red → set status `blocked` with the failing
   check name, save, and go to step 1. Do NOT merge red — agent judgment does NOT override
   a failing check. (If the project has no CI, the local gate in step 7 is the gate.)

10. **Merge**: squash-merge and delete the branch (e.g. `gh pr merge --squash
    --delete-branch`). Confirm the merge succeeded and sync the default branch.

11. Set status `done`, save the state file. End this cycle (the next cycle picks up the
    next `pending` item after the heartbeat).

## Report-only track (items with `report_only: true`)

- Do NOT create a branch, edit source, open a PR, or merge. Ever.
- Dispatch **read-only** subagents to explore whatever the item asks about.
- Write prioritized findings to the **output file** named by the item / prompt.
- Verify no source files changed, then set status `done`, save. End cycle.

## Standing rules

- One item at a time. Never parallelize ACROSS items (later items can conflict against an
  earlier item's merge). Parallelize subagents WITHIN an item only.
- The orchestrator never holds full file contents — only subagent summaries.
- Keep loop scaffolding (the state file, this workflow doc, input/output files) OUT of
  feature commits — stage feature paths explicitly, never a blind `git add -A`.
- If anything is ambiguous, prefer `blocked` with a clear note over guessing.
- When an item references an input/copy file, use its content verbatim — do not invent.
- A `blocked` item does not stop the loop — record why and move to the next item.
