import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
      /if certificate_set_is_usable; then\s+repair_certificate_permissions\s+echo "capacitylens-internal-tls: existing certificate set is valid"/,
    );
    expect(script).toContain("API_UID=${CAPACITYLENS_INTERNAL_TLS_API_UID:-1000}");
    expect(script).toContain('chown "$API_UID:$API_UID" "$API_KEY" "$API_CERT"');
    expect(script).toMatch(/mv -f "\$WORK_DIR\/api\.crt" "\$API_CERT"\s+[^]*repair_certificate_permissions/);
  });
});
