import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { MailBudgetExceededError, createMailSender, resolveMailDeliveryCause, withSendBudget } from "./mailSender";

describe("mail sender", () => {
  it("gives up on a mail server that accepts the connection but never answers", async () => {
    const sockets: Socket[] = [];
    const server = createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const sender = createMailSender({
        SMALLSASS_ACCOUNT_MAIL_HOST: "127.0.0.1",
        SMALLSASS_ACCOUNT_MAIL_PORT: String(port),
        SMALLSASS_ACCOUNT_MAIL_USER: "mailer",
        SMALLSASS_ACCOUNT_MAIL_PASSWORD: "mail-password",
        SMALLSASS_ACCOUNT_MAIL_FROM: "alfred@capacitylens.dev",
      });
      const started = Date.now();
      await expect(
        sender.send({ to: "bruce@capacitylens.dev", subject: "Your invitation", text: "Open this link." }),
      ).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(8_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);
});

const message = (to: string, accountId?: string) => ({
  to,
  subject: "Hello",
  text: "Body",
  ...(accountId ? { accountId } : {}),
});

it("refuses a recipient's sixth email within an hour and allows it once the hour has passed", async () => {
  let now = 0;
  const send = vi.fn().mockResolvedValue(undefined);
  const budgeted = withSendBudget({ send }, () => now);
  for (let sent = 0; sent < 5; sent += 1) await budgeted.send(message("Diana@Example.test"));
  const refused = budgeted.send(message("diana@example.test"));
  await expect(refused).rejects.toBeInstanceOf(MailBudgetExceededError);
  await refused.catch((cause: unknown) =>
    expect(resolveMailDeliveryCause(cause)).toEqual({ code: "MAIL_BUDGET_EXCEEDED" }),
  );
  expect(send).toHaveBeenCalledTimes(5);
  now = 60 * 60 * 1000 + 1;
  await budgeted.send(message("diana@example.test"));
  expect(send).toHaveBeenCalledTimes(6);
});

it("counts company sends only for messages charged to that company", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const budgeted = withSendBudget({ send }, () => 0);
  for (let sent = 0; sent < 50; sent += 1) await budgeted.send(message(`r${sent}@example.test`, "a1"));
  await expect(budgeted.send(message("late@example.test", "a1"))).rejects.toBeInstanceOf(MailBudgetExceededError);
  await budgeted.send(message("late@example.test", "a2"));
  await budgeted.send(message("late@example.test"));
  expect(send).toHaveBeenCalledTimes(52);
});
