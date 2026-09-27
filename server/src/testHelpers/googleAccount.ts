import type { Db } from "../db";
import { googleCallbackCapture } from "../authConfig/captureContexts";
import { captureGoogleEmailProof } from "../authConfig/googleEmailProof";

/** Model the verified profile that must accompany a Google account insert. */
export function withVerifiedGoogleProfile<T>(db: Db, profile: { subject: string; email: string }, insert: () => T): T {
  return googleCallbackCapture.run({ active: true, subject: null, email: null }, () => {
    try {
      captureGoogleEmailProof(db, { sub: profile.subject, email: profile.email, email_verified: true });
      return insert();
    } finally {
      const capture = googleCallbackCapture.getStore();
      if (capture) {
        capture.active = false;
        capture.subject = null;
        capture.email = null;
      }
    }
  });
}
