import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Normalize wrapping before checking operational clauses; editorial words are not part of the contract.
const page = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../docs-src/${path}`, import.meta.url)), "utf8").replace(/\s+/g, " ");

// Match positive operational relationships, including the negated per-company alternative.
const SITE_USER_GUIDANCE =
  /\bbackground (?:process|daemon)\b(?:(?!\b(?:not|never)\b)[^.]){0,120}\b(?:runs?|executes?) (?:as|under) (?:the )?site['’]s user\b/u;
const PROCESS_WIDE_GUIDANCE =
  /\b(?:queues|limits|safeguards) (?:are|remain) process-wide\b[^.]{0,120}\b(?:not|rather than) per-company reservations\b/u;
const IDENTITY_GLOBAL_GUIDANCE =
  /\b(?:authentication|sign-in) is identity-global\b[^.]{0,120}\b(?:before|prior to) company selection\b/u;
const ISOLATION_GUIDANCE =
  /(?:^|[.!?]\s)(?:Use|Apply) (?:edge\/global|global|edge) quotas or separate CapacityLens instances\b/u;

describe("operator documentation", () => {
  it("keeps all three supported installation routes in the self-hosting overview", () => {
    const overview = page("self-hosting/index.md");
    expect(overview).toContain("/self-hosting/install-with-docker");
    expect(overview).toContain("/self-hosting/install-without-docker");
    expect(overview).toContain("/self-hosting/managed-vps/");
    expect(overview).not.toContain("supports two ways to install");
  });

  it("runs the managed-host background process as the isolated site user", () => {
    expect(page("self-hosting/managed-vps/index.md")).toMatch(SITE_USER_GUIDANCE);
    expect(page("self-hosting/install.md")).toMatch(SITE_USER_GUIDANCE);
  });

  it("distinguishes password and SSO first-owner bootstrap settings", () => {
    const configuration = page("self-hosting/configuration.md");
    const setupTokenRow = configuration.match(/\| `CAPACITYLENS_SETUP_TOKEN` \| ([^|]+)/u)?.[1];
    expect(setupTokenRow).toContain("fresh password-mode instance");
    expect(setupTokenRow).toContain("CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS");
  });

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
    expect(monitoring).toMatch(PROCESS_WIDE_GUIDANCE);
    expect(monitoring).toMatch(IDENTITY_GLOBAL_GUIDANCE);
    expect(monitoring).toMatch(ISOLATION_GUIDANCE);
  });

  it("documents preserve-first malformed audit outbox recovery", () => {
    const incidents = page("self-hosting/incidents.md");
    expect(incidents).toContain("recover:audit-outbox -- inspect");
    expect(incidents).toContain("recover:audit-outbox -- quarantine");
    expect(incidents.toLowerCase()).toContain("never delete or update an outbox row with ad hoc sql");
    expect(incidents).toContain("refuses to overwrite an existing evidence file");
  });

  it("pins the guarded ownership-transfer recovery runbook", () => {
    const recovery = page("self-hosting/ownership-transfer-recovery.md");
    const incidents = page("self-hosting/incidents.md");
    expect(recovery).toContain("recover:ownership-transfer -- inspect");
    expect(recovery).toContain("recover:ownership-transfer -- cancel");
    expect(recovery).toContain("exclusive database lock");
    expect(recovery).toContain("revisionHex");
    expect(recovery).toContain("both participants and revision still match");
    expect(recovery).not.toContain("UPDATE account_ownership_transfers");
    expect(incidents).toContain("/self-hosting/ownership-transfer-recovery");
    expect(incidents).not.toContain("recover:ownership-transfer -- inspect");
  });

  it("documents the released over-maximum backup clamping contract", () => {
    const configuration = page("self-hosting/configuration.md");
    expect(configuration).toContain("over-maximum values clamp to 10,000 with a startup warning");
    expect(configuration).toContain("clamps over-maximum values to 35,000 with a warning");
    expect(configuration).not.toContain("over-maximum values use the safe default");
  });
});

describe("operator log commands", () => {
  // systemd rejects a bare relative time such as `--since=30m`; it needs "ago" or a leading minus.
  it("gives journalctl a relative time it can parse", () => {
    expect(page("self-hosting/monitoring.md")).toContain('journalctl -u capacitylens --since "30 min ago"');
  });
});

describe("operational guidance wording", () => {
  it.each([
    [SITE_USER_GUIDANCE, "The background daemon executes under the site's user.", true],
    [SITE_USER_GUIDANCE, "The background process must not run as the site's user.", false],
    [SITE_USER_GUIDANCE, "The background process runs as root.", false],
    [PROCESS_WIDE_GUIDANCE, "The queues remain process-wide safeguards rather than per-company reservations.", true],
    [PROCESS_WIDE_GUIDANCE, "The queues are per-company reservations, not process-wide safeguards.", false],
    [PROCESS_WIDE_GUIDANCE, "The queues are process-wide safeguards.", false],
    [IDENTITY_GLOBAL_GUIDANCE, "Password sign-in is identity-global and happens prior to company selection.", true],
    [IDENTITY_GLOBAL_GUIDANCE, "Password authentication is identity-global after company selection.", false],
    [IDENTITY_GLOBAL_GUIDANCE, "Password authentication is company-scoped before company selection.", false],
    [ISOLATION_GUIDANCE, "Apply global quotas or separate CapacityLens instances for isolation.", true],
    [ISOLATION_GUIDANCE, "Do not Use global quotas or separate CapacityLens instances.", false],
    [ISOLATION_GUIDANCE, "Every company receives its own reservation.", false],
  ])("checks the operational meaning of %s against %s", (requirement, text, accepted) => {
    expect((requirement as RegExp).test(text as string)).toBe(accepted);
  });
});
