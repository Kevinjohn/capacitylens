import { expect, it } from "vitest";
import { readMetadata, readStatus, resolveJoinStatus } from "./joinStatus";

const approved = {
  state: "approved" as const,
  accountId: "a-studio",
  purpose: "policy",
  providerId: "google",
  email: "bruce@wayne.example",
  emailHint: "b***@wayne.example",
};
const input = { accountId: "a-studio", purpose: "policy", status: approved };

it("resolves a successful Google proof to explicit completion", () => {
  expect(resolveJoinStatus(input)).toEqual({
    matched: true,
    stage: "approved",
    providerId: "google",
    email: approved.email,
    emailHint: approved.emailHint,
    deliveryUnavailable: false,
  });
});

it("keeps a scoped Google intent pending until its callback completes", () => {
  expect(
    resolveJoinStatus({
      ...input,
      status: {
        state: "pending",
        accountId: approved.accountId,
        purpose: approved.purpose,
        providerId: approved.providerId,
      },
    }),
  ).toEqual({ matched: true, stage: "pending", providerId: "google", emailHint: "", deliveryUnavailable: false });
});

it("accepts the server-bound invitation callback without a bearer token in the return URL", () => {
  expect(
    resolveJoinStatus({
      accountId: "a-studio",
      status: { ...approved, purpose: "invitation" },
    }),
  ).toMatchObject({ matched: true, stage: "approved", providerId: "google" });
});

it.each([
  { ...input, accountId: "a-loft" },
  { ...input, purpose: "invitation" },
  { ...input, status: { ...approved, state: "expired" as const } },
  { ...input, status: { ...approved, providerId: "microsoft" } },
])("returns to entry when status is not an active matching Google intent", (statusInput) => {
  expect(resolveJoinStatus(statusInput)).toEqual({ matched: false });
});

it("rejects metadata without a company name", () => {
  expect(readMetadata({ passwordAvailable: true, providerAvailable: true })).toBeNull();
});

it("rejects an unknown status state", () => {
  expect(readStatus({ state: "idle" })).toBeNull();
  expect(readStatus({ state: "joined" })).toBeNull();
});
