import nodemailer from "nodemailer";
import { isAccountEmail } from "@capacitylens/shared/account/validation";

/** Configured plain-text SMTP delivery, shared by account email flows. */
export interface MailSender {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** Preserve transport diagnostics without retaining SMTP text, credentials or mailbox contents.
 * Auth libraries can log error causes themselves, so even the retained cause must be safe. */
export function resolveMailDeliveryCause(cause: unknown): { code: string; responseCode?: number } {
  const transport = typeof cause === "object" && cause !== null ? (cause as Record<string, unknown>) : {};
  const allowedCodes = [
    "EAUTH",
    "ECONNECTION",
    "ETIMEDOUT",
    "ESOCKET",
    "EDNS",
    "ETLS",
    "EENVELOPE",
    "EMESSAGE",
    "ESTREAM",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
  ];
  const code =
    typeof transport.code === "string" && allowedCodes.includes(transport.code)
      ? transport.code
      : "MAIL_TRANSPORT_ERROR";
  const responseCode = transport.responseCode;
  return {
    code,
    ...(typeof responseCode === "number" && Number.isInteger(responseCode) && responseCode >= 100 && responseCode <= 599
      ? { responseCode }
      : {}),
  };
}

/** Validate the existing SMTP settings and create a sender; invalid settings refuse startup. */
export function createMailSender(environment: Record<string, string | undefined>): MailSender {
  const host = environment.SMALLSASS_ACCOUNT_MAIL_HOST?.trim();
  const from = environment.SMALLSASS_ACCOUNT_MAIL_FROM?.trim();
  const user = environment.SMALLSASS_ACCOUNT_MAIL_USER?.trim();
  const password = environment.SMALLSASS_ACCOUNT_MAIL_PASSWORD;
  const port = Number(environment.SMALLSASS_ACCOUNT_MAIL_PORT);
  if (
    !host ||
    !from ||
    !isAccountEmail(from) ||
    !user ||
    !password ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      "Mailbox verification requires complete SMALLSASS_ACCOUNT_MAIL_HOST, PORT, USER, PASSWORD and FROM settings.",
    );
  }
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass: password },
    tls: { rejectUnauthorized: true },
  });
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}
