import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runbook = readFileSync(fileURLToPath(new URL("../../docs/runbook.md", import.meta.url)), "utf8");

describe("operations runbook", () => {
  it("includes an executable Compose named-volume restore path", () => {
    expect(runbook).toContain("docker compose stop api");
    expect(runbook).toContain("docker compose run --rm --no-deps --entrypoint sh api");
    expect(runbook).toContain("RESTORE_SNAPSHOT must not contain a path");
    expect(runbook).toContain('cp "$source" "$temporary"');
    expect(runbook).toContain('chmod 600 "$temporary"');
    expect(runbook).toContain('rm -f "$target-wal" "$target-shm"');
    expect(runbook).toContain("docker compose up -d api");
  });

  it("documents the process-wide authentication work limits and isolation boundary", () => {
    expect(runbook).toContain("process-wide availability safeguards, not per-company reservations");
    expect(runbook).toContain("Password authentication is identity-global and occurs before company selection");
    expect(runbook).toContain("edge/global quotas or separate CapacityLens instances");
  });

  it("documents preserve-first malformed audit outbox recovery", () => {
    expect(runbook).toContain("recover:audit-outbox -- inspect");
    expect(runbook).toContain("recover:audit-outbox -- quarantine");
    expect(runbook).toContain("Never delete or update an outbox row with ad hoc SQL");
    expect(runbook).toContain("refuses to overwrite an existing evidence file");
  });

  it("documents the released over-maximum backup clamping contract", () => {
    expect(runbook).toContain("over-maximum values clamp to 10,000 with a startup warning");
    expect(runbook).toContain("clamps over-maximum values to 35,000 with a warning");
    expect(runbook).not.toContain("over-maximum values use the safe default");
  });
});
