import { begin, configured, origin } from "./microsoftProof.testSupport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authHandlerErrorCapture } from "./captureContexts";
import { createAuthRequestHandler } from "./authRequestHandler";

describe("Microsoft callback uniqueness error returns", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["captured", "thrown"])(
    "resolves a %s account coordinate failure to the original browser target",
    async (kind) => {
      const { db, auth } = await configured();
      try {
        const started = await begin(auth);
        const proof = db.prepare("SELECT id FROM microsoft_identity_proofs").get() as { id: string };
        const coordinateError = Object.assign(
          new Error("UNIQUE constraint failed: account.providerId, account.accountId"),
          { code: "SQLITE_CONSTRAINT_UNIQUE" },
        );
        const handler = createAuthRequestHandler({
          rawHandler: async () => {
            if (kind === "thrown") throw coordinateError;
            const capture = authHandlerErrorCapture.getStore();
            if (capture) capture.error = coordinateError;
            return new Response(null, { status: 500 });
          },
          providerIdFromExternalContext: () => "microsoft",
          callbackErrorUrl: () =>
            new URL(`${origin}/api/auth/microsoft-proof-return?intent=${proof.id}&outcome=failure`),
          browserAuthErrorUrl: new URL(`${origin}/sign-in`),
          commitResetSessions: () => undefined,
          reconcileFederatedLinks: () => undefined,
          microsoftProof: auth.microsoftProof,
        });
        const response = await handler(
          new Request(`${origin}/api/auth/callback/microsoft?state=${encodeURIComponent(started.state)}`, {
            headers: { cookie: started.cookies },
          }),
        );
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe(`${origin}/?error=account_already_linked_to_different_user`);
      } finally {
        db.close();
      }
    },
  );
});
