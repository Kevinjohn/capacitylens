import {
  begin,
  callback,
  claims,
  configured,
  mailFailure,
  mockMicrosoftToken,
  sentMessages,
} from "./microsoftProof.testSupport";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Microsoft mailbox-proof delivery failure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sentMessages.length = 0;
    mailFailure.enabled = false;
  });

  it("rolls a failed resend back and lets a later resend succeed", async () => {
    const { db, auth } = await configured();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const started = await begin(auth);
      mockMicrosoftToken(claims());
      await callback(auth, started.state, started.cookies);
      const headers = new Headers({ cookie: started.cookies });
      db.prepare("UPDATE microsoft_identity_proofs SET lastSentAt = ?").run(Date.now() - 61_000);
      mailFailure.enabled = true;
      await expect(auth.microsoftProof.resend(headers)).rejects.toMatchObject({
        code: "MAIL_DELIVERY_UNAVAILABLE",
        status: 503,
      });
      expect(logged).toHaveBeenCalledWith("Microsoft mailbox proof delivery failed.", {
        code: "EAUTH",
        responseCode: 535,
      });
      expect(JSON.stringify(logged.mock.calls).toLowerCase()).not.toContain("bruce@example.com");
      expect(db.prepare("SELECT state, tokenHash, tokenExpiresAt FROM microsoft_identity_proofs").get()).toEqual({
        state: "started",
        tokenHash: null,
        tokenExpiresAt: null,
      });
      mailFailure.enabled = false;
      db.prepare("UPDATE microsoft_identity_proofs SET lastSentAt = ?").run(Date.now() - 61_000);
      await auth.microsoftProof.resend(headers);
      expect(sentMessages).toHaveLength(2);
      const token = new URL(sentMessages[1]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs").get()).toEqual({ state: "mail-sent" });
      expect((await auth.microsoftProof.confirm(headers, token)).url).toContain("state=");
    } finally {
      logged.mockRestore();
      db.close();
    }
  });
});
