import { mockMicrosoftToken } from "./microsoftProof.testSupport";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("recognizes the exact Microsoft Graph origin in the provider fixture", async () => {
  mockMicrosoftToken({});
  expect((await fetch("https://graph.microsoft.com/v1.0/me/photo/$value")).status).toBe(404);
});

it.each([
  "https://graph.microsoft.com.example.org/v1.0/me",
  "https://example.org/graph.microsoft.com",
  "https://example.org/?target=graph.microsoft.com",
  "http://graph.microsoft.com/v1.0/me",
])("rejects a lookalike Graph request: %s", async (url) => {
  mockMicrosoftToken({});
  await expect(fetch(url)).rejects.toThrow("Unexpected outbound request");
});
