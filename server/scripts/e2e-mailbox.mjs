import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createSecureContext, TLSSocket } from "node:tls";

/** Test-only SMTP receiver. It requires STARTTLS, then records fictional E2E mail locally. */
export async function startE2eMailbox({ port, mailboxPath }) {
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-e2e-mail-"));
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { stdio: "ignore" },
  );
  const context = createSecureContext({ key: readFileSync(keyPath), cert: readFileSync(certPath) });
  const server = createServer((socket) => {
    let stream = socket;
    let buffer = "";
    let data = null;
    let recipient = "";
    function attach(current) {
      current.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end).replace(/\r$/, "");
          buffer = buffer.slice(end + 1);
          if (data) {
            if (line === ".") {
              appendFileSync(mailboxPath, `${JSON.stringify({ to: recipient, body: data.join("\n") })}\n`);
              data = null;
              current.write("250 Stored\r\n");
            } else data.push(line.startsWith("..") ? line.slice(1) : line);
            continue;
          }
          const command = line.split(" ", 1)[0]?.toUpperCase();
          if (command === "EHLO" || command === "HELO") {
            current.write(`250-localhost\r\n${current === socket ? "250-STARTTLS\r\n" : ""}250 AUTH PLAIN LOGIN\r\n`);
          } else if (command === "STARTTLS" && current === socket) {
            current.removeAllListeners("data");
            buffer = "";
            current.write("220 Ready to start TLS\r\n", () => {
              stream = new TLSSocket(socket, { isServer: true, secureContext: context });
              attach(stream);
            });
          } else if (current === socket && ["AUTH", "MAIL", "RCPT", "DATA"].includes(command)) {
            current.write("530 STARTTLS required\r\n");
          } else if (command === "AUTH") current.write("235 Authenticated\r\n");
          else if (command === "MAIL" || command === "RSET") current.write("250 OK\r\n");
          else if (command === "RCPT") {
            recipient = line.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? "";
            current.write("250 OK\r\n");
          } else if (command === "DATA") {
            data = [];
            current.write("354 End with .\r\n");
          } else if (command === "QUIT") {
            current.write("221 Bye\r\n");
            current.end();
          } else current.write("250 OK\r\n");
        }
      });
    }
    attach(stream);
    stream.write("220 localhost E2E mailbox\r\n");
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    certPath,
    port: server.address().port,
    close: () => {
      server.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
