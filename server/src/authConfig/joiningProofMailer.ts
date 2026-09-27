import { createMailboxProofTransport } from "./microsoftProofPrimitives";

/** Uses the configured mailbox transport without opening a connection until a join is requested. */
export function createJoiningProofMailer(environment: Record<string, string | undefined>, publicUrl: URL) {
  let mailer: ReturnType<typeof createMailboxProofTransport> | null = null;
  return async (email: string, token: string, accountId: string): Promise<void> => {
    mailer ??= createMailboxProofTransport(environment);
    const target = new URL(`/join/${encodeURIComponent(accountId)}`, publicUrl);
    target.hash = `token=${encodeURIComponent(token)}`;
    await mailer.transport.sendMail({
      from: mailer.from,
      to: email,
      subject: "Verify your company joining request",
      text: `Open this link in the browser where you started joining the company: ${target.href}\n\nThis link expires in 15 minutes.`,
    });
  };
}
