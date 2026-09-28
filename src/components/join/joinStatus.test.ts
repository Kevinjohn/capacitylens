import { expect, it } from "vitest";
import { readMetadata, readStatus, resolveJoinStatus } from "./joinStatus";

const local = {
  state: "approved" as const,
  accountId: "a-studio",
  purpose: "policy",
  providerId: "google",
  email: "bruce@wayne.example",
  emailHint: "b***@wayne.example",
};
const expired = { state: "expired" as const };
const input = { accountId: "a-studio", purpose: "policy", local, microsoft: expired };

it("prefers a matching Microsoft status over local approval", () => {
  expect(resolveJoinStatus({ ...input, microsoft: { ...local, state: "pending", providerId: "microsoft" } })).toEqual({
    matched: true,
    stage: "pending",
    providerId: "microsoft",
    email: local.email,
    emailHint: local.emailHint,
    deliveryUnavailable: false,
  });
});

it("rejects an account mismatch", () => {
  expect(resolveJoinStatus({ ...input, accountId: "a-loft" })).toEqual({ matched: false });
});

it("rejects a purpose mismatch", () => {
  expect(resolveJoinStatus({ ...input, purpose: "invitation" })).toEqual({ matched: false });
});

it("rejects an expired status even when account and purpose match", () => {
  expect(resolveJoinStatus({ ...input, local: { ...local, state: "expired" } })).toEqual({ matched: false });
});

it("resolves local approval when Microsoft has expired", () => {
  expect(resolveJoinStatus(input)).toEqual({
    matched: true,
    stage: "approved",
    providerId: "google",
    email: local.email,
    emailHint: local.emailHint,
    deliveryUnavailable: false,
  });
});

it("keeps Microsoft pending without an email or hint", () => {
  expect(
    resolveJoinStatus({
      ...input,
      local: expired,
      microsoft: {
        state: "pending",
        accountId: "a-studio",
        purpose: "policy",
        providerId: "microsoft",
      },
    }),
  ).toEqual({ matched: true, stage: "pending", providerId: "microsoft", emailHint: "", deliveryUnavailable: false });
});

it("carries non-Microsoft pending details into entry", () => {
  expect(resolveJoinStatus({ ...input, local: { ...local, state: "pending" } })).toEqual({
    matched: true,
    stage: "entry",
    providerId: "google",
    email: local.email,
    emailHint: local.emailHint,
    deliveryUnavailable: false,
  });
});

it("surfaces unavailable delivery for a matching status", () => {
  expect(resolveJoinStatus({ ...input, local: { ...local, deliveryUnavailable: true } })).toEqual({
    matched: true,
    stage: "approved",
    providerId: "google",
    email: local.email,
    emailHint: local.emailHint,
    deliveryUnavailable: true,
  });
});

it("rejects metadata without a company name", () => {
  expect(readMetadata({ passwordAvailable: true, providerAvailable: true })).toBeNull();
});

it("rejects an unknown status state", () => {
  expect(readStatus({ state: "joined" })).toBeNull();
});
