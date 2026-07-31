import { readFileSync } from "node:fs";
import { createHash, X509Certificate } from "node:crypto";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import { createSecureContext } from "node:tls";

export type InternalTlsOptions = Pick<HttpsServerOptions, "key" | "cert" | "minVersion"> & {
  expiresAt: string;
  fingerprintSha256: string;
};

export const INTERNAL_TLS_RENEW_BEFORE_SECONDS = 30 * 24 * 60 * 60;

export interface InternalTlsHealth {
  status: "ok" | "expiring" | "expired";
  expiresAt: string;
  daysRemaining: number;
  fingerprintSha256?: string;
}

export class InternalTlsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InternalTlsConfigError";
  }
}

type InternalTlsEnv = {
  CAPACITYLENS_INTERNAL_TLS_CERT?: string;
  CAPACITYLENS_INTERNAL_TLS_KEY?: string;
  CAPACITYLENS_INTERNAL_TLS_GENERATION?: string;
};

const certificateExpiresAt = (certificate: Buffer): string => {
  const parsed = Date.parse(new X509Certificate(certificate).validTo);
  if (!Number.isFinite(parsed)) throw new Error("certificate expiry is invalid");
  return new Date(parsed).toISOString();
};

/** Constant-work health projection over the certificate metadata parsed once at startup. */
export function internalTlsHealth(expiresAt: string, now = Date.now(), fingerprintSha256?: string): InternalTlsHealth {
  const parsedExpiry = Date.parse(expiresAt);
  const remainingMs = Number.isFinite(parsedExpiry) ? parsedExpiry - now : 0;
  return {
    status: remainingMs <= 0 ? "expired" : remainingMs <= INTERNAL_TLS_RENEW_BEFORE_SECONDS * 1_000 ? "expiring" : "ok",
    expiresAt,
    daysRemaining: Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1_000))),
    ...(fingerprintSha256 ? { fingerprintSha256 } : {}),
  };
}

/**
 * Load the API's internal HTTPS identity. Both paths are required together; a partial or unreadable
 * configuration refuses startup instead of silently falling back to plaintext. Omitting both keeps
 * local development and same-host reverse-proxy deployments HTTP-compatible. Production warns when
 * both are absent, while the default Compose deployment supplies a per-install certificate set.
 */
export function loadInternalTls(
  env: InternalTlsEnv,
  read: (path: string) => Buffer = (path) => readFileSync(path),
  expiry: (certificate: Buffer) => string = certificateExpiresAt,
  validateIdentity: (certificate: Buffer, privateKey: Buffer) => void = (certificate, privateKey) => {
    createSecureContext({ cert: certificate, key: privateKey });
  },
): InternalTlsOptions | undefined {
  const rawCertPath = env.CAPACITYLENS_INTERNAL_TLS_CERT;
  const rawKeyPath = env.CAPACITYLENS_INTERNAL_TLS_KEY;
  const rawGenerationPath = env.CAPACITYLENS_INTERNAL_TLS_GENERATION;
  const certPath = rawCertPath?.trim();
  const keyPath = rawKeyPath?.trim();
  const generationPath = rawGenerationPath?.trim();

  if (rawCertPath === undefined && rawKeyPath === undefined && rawGenerationPath === undefined) return undefined;
  if (!certPath || !keyPath) {
    throw new InternalTlsConfigError(
      "CAPACITYLENS_INTERNAL_TLS_CERT and CAPACITYLENS_INTERNAL_TLS_KEY must be configured together.",
    );
  }

  let cert: Buffer;
  let key: Buffer;
  try {
    cert = read(certPath);
    key = read(keyPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InternalTlsConfigError(`Unable to read the configured internal TLS identity: ${detail}`);
  }
  if (cert.length === 0 || key.length === 0) {
    throw new InternalTlsConfigError("The configured internal TLS certificate and key must not be empty.");
  }

  try {
    validateIdentity(cert, key);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InternalTlsConfigError(`The configured internal TLS identity is invalid: ${detail}`);
  }

  let expiresAt: string;
  try {
    expiresAt = expiry(cert);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InternalTlsConfigError(`The configured internal TLS certificate is invalid: ${detail}`);
  }
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new InternalTlsConfigError("The configured internal TLS certificate expiry is invalid.");
  }

  const fingerprintSha256 = createHash("sha256").update(cert).digest("hex");
  if (rawGenerationPath !== undefined) {
    if (!generationPath) {
      throw new InternalTlsConfigError("CAPACITYLENS_INTERNAL_TLS_GENERATION must not be blank when configured.");
    }
    let publishedGeneration: string;
    try {
      publishedGeneration = read(generationPath).toString("utf8").trim();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new InternalTlsConfigError(`Unable to read the configured internal TLS generation: ${detail}`);
    }
    if (!/^[a-f0-9]{64}$/.test(publishedGeneration) || publishedGeneration !== fingerprintSha256) {
      throw new InternalTlsConfigError(
        "The configured internal TLS certificate does not match its published generation.",
      );
    }
  }

  return {
    cert,
    key,
    minVersion: "TLSv1.2",
    expiresAt: new Date(expiresAt).toISOString(),
    fingerprintSha256,
  };
}
