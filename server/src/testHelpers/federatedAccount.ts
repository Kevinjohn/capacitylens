import type { Db } from "../db";
import { federatedCallbackCapture } from "../authConfig/captureContexts";
import { captureVerifiedFederatedEmailProof } from "../authConfig/federatedEmailProof";

/** Model the verified provider result that must accompany an account insert. */
export function withVerifiedFederatedProfile<T>(
  db: Db,
  profile: { providerId: "google" | "github"; subject: string; email: string },
  insert: () => T,
): T {
  return federatedCallbackCapture.run(
    { active: true, providerId: profile.providerId, subject: null, email: null },
    () => {
      try {
        captureVerifiedFederatedEmailProof(db, { ...profile, verified: true });
        return insert();
      } finally {
        const capture = federatedCallbackCapture.getStore();
        if (capture) {
          capture.active = false;
          capture.subject = null;
          capture.email = null;
        }
      }
    },
  );
}

export function insertVerifiedFederatedAccount(
  db: Db,
  input: {
    id: string;
    providerId: "google" | "github";
    subject: string;
    principalId: string;
    email: string;
  },
): void {
  withVerifiedFederatedProfile(db, input, () => {
    const at = new Date().toISOString();
    db.prepare(
      "INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(input.id, input.providerId, input.subject, input.principalId, at, at);
  });
}
