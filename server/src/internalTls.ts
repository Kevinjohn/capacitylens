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
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InternalTlsConfigError";
  }
}

type InternalTlsEnv = {
  CAPACITYLENS_INTERNAL_TLS_CERT?: string;
  CAPACITYLENS_INTERNAL_TLS_KEY?: string;
  CAPACITYLENS_INTERNAL_TLS_GENERATION?: string;
};

const parseCertificateExpiry = (certificate: Buffer): string => {
  const parsed = Date.parse(new X509Certificate(certificate).validTo);
  if (!Number.isFinite(parsed)) throw new Error("certificate expiry is invalid");
  return new Date(parsed).toISOString();
};

const resolveInternalTlsStatus = (remainingMs: number): InternalTlsHealth["status"] => {
  if (remainingMs <= 0) return "expired";
  if (remainingMs <= INTERNAL_TLS_RENEW_BEFORE_SECONDS * 1_000) return "expiring";
  return "ok";
};

/** Constant-work health projection over the certificate metadata parsed once at startup. */
export function buildInternalTlsHealth(
  expiresAt: string,
  now = Date.now(),
  fingerprintSha256?: string,
): InternalTlsHealth {
  const parsedExpiry = Date.parse(expiresAt);
  const remainingMs = Number.isFinite(parsedExpiry) ? parsedExpiry - now : 0;
  return {
    status: resolveInternalTlsStatus(remainingMs),
    expiresAt,
    daysRemaining: Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1_000))),
    ...(fingerprintSha256 ? { fingerprintSha256 } : {}),
  };
}

interface LoadInternalTlsInput {
  environment: InternalTlsEnv;
  read?: ((path: string) => Buffer) | undefined;
  expiry?: ((certificate: Buffer) => string) | undefined;
  validateIdentity?: ((certificate: Buffer, privateKey: Buffer) => void) | undefined;
}

interface ReadInternalTlsIdentityInput {
  certPath: string;
  keyPath: string;
  readFile: (path: string) => Buffer;
}

const readInternalTlsIdentity = ({ certPath, keyPath, readFile }: ReadInternalTlsIdentityInput) => {
  let cert: Buffer;
  let key: Buffer;
  try {
    cert = readFile(certPath);
    key = readFile(keyPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InternalTlsConfigError(`Unable to read the configured internal TLS identity: ${detail}`, {
      cause: error,
    });
  }
  if (cert.length === 0 || key.length === 0) {
    throw new InternalTlsConfigError("The configured internal TLS certificate and key must not be empty.");
  }
  return { cert, key };
};

interface ValidateInternalTlsIdentityInput {
  cert: Buffer;
  key: Buffer;
  validateIdentity: (certificate: Buffer, privateKey: Buffer) => void;
}

const assertInternalTlsIdentityValid = ({ cert, key, validateIdentity }: ValidateInternalTlsIdentityInput): void => {
  try {
    validateIdentity(cert, key);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InternalTlsConfigError(`The configured internal TLS identity is invalid: ${detail}`, { cause: error });
  }
};

const parseInternalTlsExpiry = (cert: Buffer, expiry: (certificate: Buffer) => string): string => {
  let expiresAt: string;
  try {
    expiresAt = expiry(cert);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InternalTlsConfigError(`The configured internal TLS certificate is invalid: ${detail}`, { cause: error });
  }
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new InternalTlsConfigError("The configured internal TLS certificate expiry is invalid.");
  }
  return new Date(expiresAt).toISOString();
};

interface AssertInternalTlsGenerationInput {
  rawGenerationPath: string | undefined;
  generationPath: string | undefined;
  fingerprintSha256: string;
  readFile: (path: string) => Buffer;
}

const assertInternalTlsGeneration = ({
  rawGenerationPath,
  generationPath,
  fingerprintSha256,
  readFile,
}: AssertInternalTlsGenerationInput): void => {
  if (rawGenerationPath === undefined) return;
  if (!generationPath) {
    throw new InternalTlsConfigError("CAPACITYLENS_INTERNAL_TLS_GENERATION must not be blank when configured.");
  }
  let publishedGeneration: string;
  try {
    publishedGeneration = readFile(generationPath).toString("utf8").trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InternalTlsConfigError(`Unable to read the configured internal TLS generation: ${detail}`, {
      cause: error,
    });
  }
  if (!/^[a-f0-9]{64}$/.test(publishedGeneration) || publishedGeneration !== fingerprintSha256) {
    throw new InternalTlsConfigError(
      "The configured internal TLS certificate does not match its published generation.",
    );
  }
};

/**
 * Load the API's internal HTTPS identity. Both paths are required together; a partial or unreadable
 * configuration refuses startup instead of silently falling back to plaintext. Omitting both keeps
 * local development and same-host reverse-proxy deployments HTTP-compatible. Production warns when
 * both are absent, while the default Compose deployment supplies a per-install certificate set.
 */
export function loadInternalTls({
  environment,
  read = (path) => readFileSync(path),
  expiry = parseCertificateExpiry,
  validateIdentity = (certificate, privateKey) => {
    createSecureContext({ cert: certificate, key: privateKey });
  },
}: LoadInternalTlsInput): InternalTlsOptions | undefined {
  const rawCertPath = environment.CAPACITYLENS_INTERNAL_TLS_CERT;
  const rawKeyPath = environment.CAPACITYLENS_INTERNAL_TLS_KEY;
  const rawGenerationPath = environment.CAPACITYLENS_INTERNAL_TLS_GENERATION;
  const certPath = rawCertPath?.trim();
  const keyPath = rawKeyPath?.trim();
  const generationPath = rawGenerationPath?.trim();

  if (rawCertPath === undefined && rawKeyPath === undefined && rawGenerationPath === undefined) return undefined;
  if (!certPath || !keyPath) {
    throw new InternalTlsConfigError(
      "CAPACITYLENS_INTERNAL_TLS_CERT and CAPACITYLENS_INTERNAL_TLS_KEY must be configured together.",
    );
  }

  const { cert, key } = readInternalTlsIdentity({ certPath, keyPath, readFile: read });
  assertInternalTlsIdentityValid({ cert, key, validateIdentity });
  const expiresAt = parseInternalTlsExpiry(cert, expiry);
  const fingerprintSha256 = createHash("sha256").update(cert).digest("hex");
  assertInternalTlsGeneration({ rawGenerationPath, generationPath, fingerprintSha256, readFile: read });

  return {
    cert,
    key,
    minVersion: "TLSv1.2",
    expiresAt,
    fingerprintSha256,
  };
}
