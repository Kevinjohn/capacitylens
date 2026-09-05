import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  INTERNAL_TLS_RENEW_BEFORE_SECONDS,
  InternalTlsConfigError,
  internalTlsHealth,
  loadInternalTls,
} from "./internalTls";

describe("loadInternalTls", () => {
  it("keeps local development on HTTP when both paths are omitted", () => {
    const read = vi.fn<(path: string) => Buffer>();
    expect(loadInternalTls({}, read)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    [{ CAPACITYLENS_INTERNAL_TLS_CERT: "/tls/api.crt" }],
    [{ CAPACITYLENS_INTERNAL_TLS_KEY: "/tls/api.key" }],
    [{ CAPACITYLENS_INTERNAL_TLS_GENERATION: "/tls/api.crt.sha256" }],
    [
      {
        CAPACITYLENS_INTERNAL_TLS_CERT: "  ",
        CAPACITYLENS_INTERNAL_TLS_KEY: "/tls/api.key",
      },
    ],
    [
      {
        CAPACITYLENS_INTERNAL_TLS_CERT: "  ",
        CAPACITYLENS_INTERNAL_TLS_KEY: "\t",
      },
    ],
  ])("fails closed when the configured path pair is incomplete or blank", (env) => {
    expect(() => loadInternalTls(env)).toThrow(InternalTlsConfigError);
  });

  it("loads both files and pins the minimum protocol to TLS 1.2", () => {
    const read = vi.fn((path: string) => Buffer.from(path.endsWith(".crt") ? "certificate" : "key"));
    expect(
      loadInternalTls(
        {
          CAPACITYLENS_INTERNAL_TLS_CERT: "/tls/api.crt",
          CAPACITYLENS_INTERNAL_TLS_KEY: "/tls/api.key",
        },
        read,
        () => "2027-01-01T00:00:00.000Z",
        () => undefined,
      ),
    ).toEqual({
      cert: Buffer.from("certificate"),
      key: Buffer.from("key"),
      minVersion: "TLSv1.2",
      expiresAt: "2027-01-01T00:00:00.000Z",
      fingerprintSha256: createHash("sha256").update("certificate").digest("hex"),
    });
    expect(read.mock.calls).toEqual([["/tls/api.crt"], ["/tls/api.key"]]);
  });

  it("frames unreadable and empty identities as configuration errors", () => {
    expect(() =>
      loadInternalTls(
        {
          CAPACITYLENS_INTERNAL_TLS_CERT: "/tls/api.crt",
          CAPACITYLENS_INTERNAL_TLS_KEY: "/tls/api.key",
        },
        () => {
          throw new Error("permission denied");
        },
      ),
    ).toThrow(/Unable to read.*permission denied/);

    expect(() =>
      loadInternalTls(
        {
          CAPACITYLENS_INTERNAL_TLS_CERT: "/tls/api.crt",
          CAPACITYLENS_INTERNAL_TLS_KEY: "/tls/api.key",
        },
        () => Buffer.alloc(0),
      ),
    ).toThrow(/must not be empty/);
  });

  it("fails closed when the configured certificate cannot be parsed", () => {
    expect(() =>
      loadInternalTls(
        {
          CAPACITYLENS_INTERNAL_TLS_CERT: "/tls/api.crt",
          CAPACITYLENS_INTERNAL_TLS_KEY: "/tls/api.key",
        },
        () => Buffer.from("not-a-certificate"),
      ),
    ).toThrow(/TLS identity is invalid/i);
  });

  it("frames a malformed or mismatched private key as a configuration error", () => {
    expect(() =>
      loadInternalTls(
        {
          CAPACITYLENS_INTERNAL_TLS_CERT: "/tls/api.crt",
          CAPACITYLENS_INTERNAL_TLS_KEY: "/tls/api.key",
        },
        (path) => Buffer.from(path.endsWith(".crt") ? "certificate" : "malformed-key"),
        () => "2027-01-01T00:00:00.000Z",
        () => {
          throw new Error("key values mismatch");
        },
      ),
    ).toThrow(/TLS identity is invalid.*key values mismatch/i);
  });

  it("requires a configured generation marker to match the exact certificate bytes", () => {
    const certificate = Buffer.from("certificate");
    const fingerprint = createHash("sha256").update(certificate).digest("hex");
    const env = {
      CAPACITYLENS_INTERNAL_TLS_CERT: "/tls/api.crt",
      CAPACITYLENS_INTERNAL_TLS_KEY: "/tls/api.key",
      CAPACITYLENS_INTERNAL_TLS_GENERATION: "/tls/api.crt.sha256",
    };
    const load = (generation: string) =>
      loadInternalTls(
        env,
        (path) => {
          if (path.endsWith(".crt")) return certificate;
          if (path.endsWith(".key")) return Buffer.from("key");
          return Buffer.from(generation);
        },
        () => "2027-01-01T00:00:00.000Z",
        () => undefined,
      );

    expect(load(fingerprint)).toMatchObject({ fingerprintSha256: fingerprint });
    expect(() => load("0".repeat(64))).toThrow(/does not match its published generation/);
    expect(() => load("not-a-digest")).toThrow(/does not match its published generation/);
  });

  it("reports ok, renewal-window and expired states at exact boundaries", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const expiry = (seconds: number) => new Date(now + seconds * 1_000).toISOString();

    expect(internalTlsHealth(expiry(INTERNAL_TLS_RENEW_BEFORE_SECONDS + 1), now)).toMatchObject({
      status: "ok",
      daysRemaining: 31,
    });
    expect(internalTlsHealth(expiry(INTERNAL_TLS_RENEW_BEFORE_SECONDS), now)).toMatchObject({
      status: "expiring",
      daysRemaining: 30,
    });
    expect(internalTlsHealth(expiry(0), now)).toMatchObject({
      status: "expired",
      daysRemaining: 0,
    });
  });

  it("fails a malformed projected expiry closed instead of reporting healthy", () => {
    expect(internalTlsHealth("not-a-certificate-expiry", Date.parse("2026-01-01T00:00:00.000Z"))).toEqual({
      status: "expired",
      expiresAt: "not-a-certificate-expiry",
      daysRemaining: 0,
    });
  });

  it("uses the same renewal boundary as the certificate initializer", () => {
    const script = readFileSync(new URL("../../scripts/internal-tls.sh", import.meta.url), "utf8");
    expect(script).toContain(
      `RENEW_BEFORE_SECONDS=\${CAPACITYLENS_INTERNAL_TLS_RENEW_BEFORE_SECONDS:-${INTERNAL_TLS_RENEW_BEFORE_SECONDS}}`,
    );
  });

  it("repairs certificate permissions before accepting an existing valid set", () => {
    const script = readFileSync(new URL("../../scripts/internal-tls.sh", import.meta.url), "utf8");
    expect(script).toMatch(
      /if certificate_set_is_usable; then\s+repair_certificate_permissions\s+publish_generation\s+echo "capacitylens-internal-tls: existing certificate set is valid"/,
    );
    expect(script).toContain("API_UID=${CAPACITYLENS_INTERNAL_TLS_API_UID:-1000}");
    expect(script).toContain('chown "$API_UID:$API_UID" "$API_KEY" "$API_CERT"');
    expect(script).toMatch(/mv -f "\$WORK_DIR\/api\.crt" "\$API_CERT"\s+[^]*repair_certificate_permissions/);
  });

  it("stages renewal on the certificate filesystem and preserves a still-usable CA", () => {
    const script = readFileSync(new URL("../../scripts/internal-tls.sh", import.meta.url), "utf8");
    expect(script).toContain('WORK_DIR=$(mktemp -d "$TLS_DIR/.capacitylens-tls-stage.XXXXXX")');
    expect(script).toMatch(/if ca_is_usable; then\s+REUSE_CA=1/);
    expect(script).toMatch(/if test "\$REUSE_CA" -eq 0; then\s+mv -f "\$WORK_DIR\/ca\.key" "\$CA_KEY"/);
  });

  it("executes fresh initialization, refuses uncoordinated renewal and rotates a leaf safely", () => {
    const root = mkdtempSync(join(tmpdir(), "capacitylens-internal-tls-"));
    const tlsDir = join(root, "tls");
    const binDir = join(root, "bin");
    const script = fileURLToPath(new URL("../../scripts/internal-tls.sh", import.meta.url));
    try {
      mkdirSync(binDir);
      const chown = join(binDir, "chown");
      writeFileSync(chown, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
      chmodSync(chown, 0o700);
      const run = (extraEnv: Record<string, string> = {}) =>
        spawnSync("sh", [script], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
            CAPACITYLENS_INTERNAL_TLS_DIR: tlsDir,
            ...extraEnv,
          },
        });

      const fresh = run();
      expect(fresh.status, fresh.stderr).toBe(0);
      const caBefore = readFileSync(join(tlsDir, "ca.crt"));
      const leafBefore = readFileSync(join(tlsDir, "api.crt"));
      expect(statSync(join(tlsDir, "ca.key")).mode & 0o777).toBe(0o400);
      expect(statSync(join(tlsDir, "api.crt")).mode & 0o777).toBe(0o444);
      expect(readFileSync(join(tlsDir, "api.crt.sha256"), "utf8").trim()).toBe(
        createHash("sha256").update(leafBefore).digest("hex"),
      );

      const refused = run({ CAPACITYLENS_INTERNAL_TLS_RENEW_BEFORE_SECONDS: "315360000" });
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain("needs coordinated renewal");
      expect(readFileSync(join(tlsDir, "api.crt"))).toEqual(leafBefore);

      const rotated = run({
        CAPACITYLENS_INTERNAL_TLS_RENEW_BEFORE_SECONDS: "315360000",
        CAPACITYLENS_INTERNAL_TLS_ROTATE: "1",
      });
      expect(rotated.status, rotated.stderr).toBe(0);
      const leafAfter = readFileSync(join(tlsDir, "api.crt"));
      expect(leafAfter).not.toEqual(leafBefore);
      expect(readFileSync(join(tlsDir, "ca.crt"))).toEqual(caBefore);
      expect(readFileSync(join(tlsDir, "api.crt.sha256"), "utf8").trim()).toBe(
        createHash("sha256").update(leafAfter).digest("hex"),
      );
      const verify = spawnSync("openssl", ["verify", "-CAfile", join(tlsDir, "ca.crt"), join(tlsDir, "api.crt")]);
      expect(verify.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});
