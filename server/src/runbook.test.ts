import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Whitespace-normalized so markdown line wrapping cannot break an exact-phrase pin.
const page = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../docs-src/${path}`, import.meta.url)), "utf8").replace(/\s+/g, " ");

describe("operator documentation", () => {
  it("includes an executable Compose named-volume restore path", () => {
    const restore = page("self-hosting/backups-and-restore.md");
    expect(restore).toContain("docker compose stop api");
    expect(restore).toContain("docker compose run --rm --no-deps --entrypoint sh api");
    expect(restore).toContain("RESTORE_SNAPSHOT must not contain a path");
    expect(restore).toContain('cp "$source" "$temporary"');
    expect(restore).toContain('chmod 600 "$temporary"');
    expect(restore).toContain('rm -f "$target-wal" "$target-shm"');
    expect(restore).toContain("docker compose up -d api");
  });

  it("documents the process-wide authentication work limits and isolation boundary", () => {
    const monitoring = page("self-hosting/monitoring.md");
    expect(monitoring).toContain("process-wide availability safeguards, not per-company reservations");
    expect(monitoring).toContain("Password authentication is identity-global and occurs before company selection");
    expect(monitoring).toContain("edge/global quotas or separate CapacityLens instances");
  });

  it("documents preserve-first malformed audit outbox recovery", () => {
    const incidents = page("self-hosting/incidents.md");
    expect(incidents).toContain("recover:audit-outbox -- inspect");
    expect(incidents).toContain("recover:audit-outbox -- quarantine");
    expect(incidents.toLowerCase()).toContain("never delete or update an outbox row with ad hoc sql");
    expect(incidents).toContain("refuses to overwrite an existing evidence file");
  });

  it("documents the released over-maximum backup clamping contract", () => {
    const configuration = page("self-hosting/configuration.md");
    expect(configuration).toContain("over-maximum values clamp to 10,000 with a startup warning");
    expect(configuration).toContain("clamps over-maximum values to 35,000 with a warning");
    expect(configuration).not.toContain("over-maximum values use the safe default");
  });
});
