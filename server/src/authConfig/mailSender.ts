import nodemailer from "nodemailer";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";

/** Configured plain-text SMTP delivery, shared by account email flows. `accountId` names the
 * company a budgeted send is charged to; only a company's own administrators may set it. */
export interface MailSender {
  send(message: { to: string; subject: string; text: string; accountId?: string }): Promise<void>;
}

const HOUR_MS = 60 * 60 * 1000;
const RECIPIENT_SENDS_PER_HOUR = 5;
const COMPANY_SENDS_PER_HOUR = 50;

export class MailBudgetExceededError extends Error {
  constructor() {
    super("Email send budget exceeded.");
    this.name = "MailBudgetExceededError";
  }
}

/** Cap user-triggered mail per recipient and per company over a rolling hour. The recipient budget
 * is kept per company (and separately for uncharged sends such as joining verification), so one
 * company's administrator cannot spend it and block another company's invitation or the recipient's
 * own verification email. The server is one process, so an in-memory window covers every send; a
 * restart only resets it early. Password
 * reset and Microsoft proof keep their own limiters and must not share this budget: a stranger
 * could otherwise spend it on a victim's address and block the victim's own recovery mail. */
export function withSendBudget(sender: MailSender, now: () => number = Date.now): MailSender {
  const sent = new Map<string, number[]>();
  const recent = (key: string): number[] => (sent.get(key) ?? []).filter((at) => at > now() - HOUR_MS);
  return {
    async send(message) {
      // Forget expired recipients so a long-running server keeps only the last hour.
      for (const [key, times] of sent) if (!times.some((at) => at > now() - HOUR_MS)) sent.delete(key);
      const chargedTo = message.accountId === undefined ? "uncharged" : `company:${message.accountId}`;
      const budgets: [string, number][] = [
        [`to:${chargedTo}:${normalizeAccountEmail(message.to)}`, RECIPIENT_SENDS_PER_HOUR],
      ];
      if (message.accountId !== undefined) budgets.push([`company:${message.accountId}`, COMPANY_SENDS_PER_HOUR]);
      if (budgets.some(([key, limit]) => recent(key).length >= limit)) throw new MailBudgetExceededError();
      // Count the attempt before awaiting delivery, so concurrent requests cannot overspend.
      for (const [key] of budgets) sent.set(key, [...recent(key), now()]);
      await sender.send(message);
    },
  };
}

/** Preserve transport diagnostics without retaining SMTP text, credentials or mailbox contents.
 * Auth libraries can log error causes themselves, so even the retained cause must be safe. */
export function resolveMailDeliveryCause(cause: unknown): { code: string; responseCode?: number } {
  if (cause instanceof MailBudgetExceededError) return { code: "MAIL_BUDGET_EXCEEDED" };
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
  const host = environment.CAPACITYLENS_MAIL_HOST?.trim();
  const from = environment.CAPACITYLENS_MAIL_FROM?.trim();
  const user = environment.CAPACITYLENS_MAIL_USER?.trim();
  const password = environment.CAPACITYLENS_MAIL_PASSWORD;
  const port = Number(environment.CAPACITYLENS_MAIL_PORT);
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
    throw new Error("Email delivery requires complete CAPACITYLENS_MAIL_HOST, PORT, USER, PASSWORD and FROM settings.");
  }
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass: password },
    tls: { rejectUnauthorized: true },
    // Invitation and joining sends are awaited inside a request that holds the authentication
    // transaction gate. Nodemailer's defaults (minutes) would let a stalled mail server hold every
    // request behind a pending sign-in, and outlast the browser's deadline for the copy link.
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}
