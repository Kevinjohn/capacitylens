import { createHash } from "node:crypto";
import { createInvalidProviderSessionError } from "./vendorErrors";

export function buildStableFallbackSessionId(applicationId: string, principalId: string, createdAt: string): string {
  return createHash("sha256")
    .update(`${applicationId}-session-id\0`)
    .update(principalId)
    .update("\0")
    .update(createdAt)
    .digest("base64url");
}

export function buildIsoInstant(value: string | number): string {
  const milliseconds = parseTimestampMilliseconds(value);
  if (milliseconds === null) throw new RangeError("Invalid time value");
  return new Date(milliseconds).toISOString();
}

/** Normalize supported timestamps to finite milliseconds; malformed values have no instant. */
export function parseTimestampMilliseconds(value: string | number): number | null {
  const numeric = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  const milliseconds =
    typeof numeric === "number" && numeric < 10_000_000_000 ? numeric * 1000 : new Date(numeric).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function parseProviderInstant(value: string | number, field: "createdAt" | "expiresAt"): string {
  const milliseconds = parseTimestampMilliseconds(value);
  if (milliseconds === null) {
    throw createInvalidProviderSessionError(`The provider session has an invalid ${field} timestamp.`);
  }
  return new Date(milliseconds).toISOString();
}
