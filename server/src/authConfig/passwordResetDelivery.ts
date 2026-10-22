import type { Db } from "../db";
import { resolveMailDeliveryCause } from "./mailSender";
import type { MailSender } from "./mailSender";
import { resetTokenCapture } from "./captureContexts";
import { hasPasswordCredential } from "./tableAccess";

/** Capture admin copy-links, or email public resets only to existing password identities.
 * Delivery runs in the background so SMTP latency does not expose registered addresses. */
export async function captureResetToken(
  { user, token }: { user: { id: string; email: string }; token: string },
  { db, mail, publicUrl }: { db: Db; mail: MailSender | null; publicUrl: URL },
): Promise<void> {
  const store = resetTokenCapture.getStore();
  if (store) {
    store.token = token;
    return;
  }
  if (!mail || !hasPasswordCredential(db, user.id)) return;
  const link = new URL("/reset-password/" + encodeURIComponent(token), publicUrl);
  void mail
    .send({
      to: user.email,
      subject: "Reset your password",
      text: `Open this link to reset your password: ${link.href}\n\nThis link expires in 24 hours.`,
    })
    .catch((cause: unknown) => console.error("Password reset email delivery failed", resolveMailDeliveryCause(cause)));
}
