import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import nodemailer from "nodemailer";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";

export type MicrosoftProofPurpose = "bootstrap" | "invite" | "link";
export type MicrosoftProofState = "started" | "mail-sent" | "approved" | "completed" | "cancelled";
export type MicrosoftProofIntent = {
  id: string;
  nonceHash: string;
  purpose: MicrosoftProofPurpose;
  targetEmail: string;
  inviteId: string | null;
  accountId: string | null;
  principalId: string | null;
  sessionId: string | null;
  tenantId: string;
  oid: string | null;
  tokenHash: string | null;
  state: MicrosoftProofState;
  expiresAt: number;
  tokenExpiresAt: number | null;
  sentCount: number;
  lastSentAt: number | null;
  sourceIpHash: string;
  oauthStateHash: string | null;
  oauthStateHistory: string;
  callbackUrl: string;
  errorCallbackUrl: string;
};

export type MicrosoftProofSession = {
  user: { id: string; email: string; emailVerified: boolean; twoFactorEnabled?: boolean };
  session?: { id: string; createdAt: string; expiresAt: string | null };
} | null;

export class MicrosoftProofError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}

/** Preserve transport diagnostics without retaining SMTP text, credentials or mailbox contents.
 * Auth libraries can log error causes themselves, so even the retained cause must be safe. */
export function resolveMicrosoftMailDeliveryCause(cause: unknown): { code: string; responseCode?: number } {
  const transport = typeof cause === "object" && cause !== null ? (cause as Record<string, unknown>) : {};
  const allowedCodes = [
    "EAUTH",
    "ECONNECTION",
    "ETIMEDOUT",
    "ESOCKET",
    "EDNS",
    "ETLS",
    "EENVELOPE",
    "EMESSAGE",
    "ESTREAM",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
  ];
  const code =
    typeof transport.code === "string" && allowedCodes.includes(transport.code)
      ? transport.code
      : "MAIL_TRANSPORT_ERROR";
  const responseCode = transport.responseCode;
  return {
    code,
    ...(typeof responseCode === "number" && Number.isInteger(responseCode) && responseCode >= 100 && responseCode <= 599
      ? { responseCode }
      : {}),
  };
}

export function hashProofValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function equalProofHashes(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newProofSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function newProofId(): string {
  return randomUUID();
}

export function readProofCookie(headers: Headers, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return null;
}

export function hintProofEmail(email: string): string {
  const at = email.indexOf("@");
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export function hasVerifiedMicrosoftEmail(profile: Record<string, unknown>, target: string): boolean {
  const address = typeof profile.email === "string" ? normalizeAccountEmail(profile.email) : "";
  const verified = (value: unknown) =>
    Array.isArray(value) && value.some((item) => typeof item === "string" && normalizeAccountEmail(item) === target);
  return (
    address === target &&
    (profile.email_verified === true ||
      verified(profile.verified_primary_email) ||
      verified(profile.verified_secondary_email))
  );
}

export function readMicrosoftProofIntent(db: Db, nonceHash: string): MicrosoftProofIntent | null {
  return (
    (db.prepare("SELECT * FROM microsoft_identity_proofs WHERE nonceHash = ?").get(nonceHash) as
      MicrosoftProofIntent | undefined) ?? null
  );
}

export function assertMicrosoftReturnUrl(value: string, origins: ReadonlySet<string>): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MicrosoftProofError("INVALID_CALLBACK_URL", 400);
  }
  if (!origins.has(parsed.origin) || parsed.username || parsed.password) {
    throw new MicrosoftProofError("INVALID_CALLBACK_URL", 400);
  }
  return parsed.href;
}

/** Invitation return URLs may contain their bearer in the path; keep them encrypted in proof storage. */
export function createMicrosoftReturnUrlCipher(secret: string) {
  const key = createHash("sha256").update("capacitylens-microsoft-proof-url\0").update(secret).digest();
  return {
    encrypt(url: string): string {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const encrypted = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
    },
    decrypt(value: string): string {
      const bytes = Buffer.from(value, "base64url");
      if (bytes.length < 28) throw new Error("Stored Microsoft callback is invalid.");
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    },
    hashIp(address: string): string {
      return createHmac("sha256", secret).update(address).digest("hex");
    },
  };
}

export function createMicrosoftProofMailer(environment: Record<string, string | undefined>, publicUrl: URL) {
  const host = environment.SMALLSASS_ACCOUNT_MAIL_HOST?.trim();
  const from = environment.SMALLSASS_ACCOUNT_MAIL_FROM?.trim();
  const user = environment.SMALLSASS_ACCOUNT_MAIL_USER?.trim();
  const password = environment.SMALLSASS_ACCOUNT_MAIL_PASSWORD;
  const port = Number(environment.SMALLSASS_ACCOUNT_MAIL_PORT);
  if (
    !host ||
    !from ||
    !isAccountEmail(from) ||
    !user ||
    !password ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      "Microsoft sign-in requires complete SMALLSASS_ACCOUNT_MAIL_HOST, PORT, USER, PASSWORD and FROM settings.",
    );
  }
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass: password },
    tls: { rejectUnauthorized: true },
  });
  return async (targetEmail: string, token: string) => {
    const target = new URL("/verify-microsoft", publicUrl);
    target.hash = `token=${encodeURIComponent(token)}`;
    await transport.sendMail({
      from,
      to: targetEmail,
      subject: "Verify your Microsoft connection",
      text: `Open this link and confirm your Microsoft connection: ${target.href}\n\nThis link expires in 15 minutes.`,
    });
  };
}
