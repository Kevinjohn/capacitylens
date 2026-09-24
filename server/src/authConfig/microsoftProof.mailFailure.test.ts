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

// eslint-disable-next-line max-lines-per-function -- The delivery-failure cases share one controlled provider and SMTP harness.
describe("Microsoft mailbox-proof delivery failure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sentMessages.length = 0;
    mailFailure.enabled = false;
  });

  it("keeps delivery failure retryable without issuing a user or claiming verification", async () => {
    const { db, auth } = await configured();
    try {
      const started = await begin(auth);
      mockMicrosoftToken(claims());
      mailFailure.enabled = true;
      const first = await callback(auth, started.state, started.cookies);
      expect(first.headers.get("location")).toContain("/verify-microsoft?state=check-email");
      expect(auth.microsoftProof.status(new Headers({ cookie: started.cookies }))).toMatchObject({
        state: "pending",
        deliveryUnavailable: true,
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT state, tokenHash FROM microsoft_identity_proofs").get()).toEqual({
        state: "started",
        tokenHash: null,
      });
    } finally {
      db.close();
    }
  });

  it("logs a failed resend without the recipient or token, rolls it back and lets a later resend succeed", async () => {
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
      expect(logged).toHaveBeenCalledWith("Microsoft mailbox-proof email could not be sent.", {
        code: "EENVELOPE",
        reason: "550 <[address]> rejected",
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
