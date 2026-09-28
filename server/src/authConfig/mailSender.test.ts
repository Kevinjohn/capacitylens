import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createMailSender } from "./mailSender";

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
