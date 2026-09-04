import { createHash } from "node:crypto";
import { invalidProviderSession } from "./vendorErrors";

export function stableFallbackSessionId(applicationId: string, principalId: string, createdAt: string): string {
  return createHash("sha256")
    .update(`${applicationId}-session-id\0`)
    .update(principalId)
    .update("\0")
    .update(createdAt)
    .digest("base64url");
}

export function iso(value: string | number): string {
  return new Date(timestampMs(value)).toISOString();
}

export function timestampMs(value: string | number): number {
  const numeric = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof numeric === "number" && numeric < 10_000_000_000 ? numeric * 1000 : new Date(numeric).getTime();
}

export function providerInstant(value: string | number, field: "createdAt" | "expiresAt"): string {
  const milliseconds = timestampMs(value);
  if (!Number.isFinite(milliseconds)) {
    throw invalidProviderSession(`The provider session has an invalid ${field} timestamp.`);
  }
  return new Date(milliseconds).toISOString();
}
