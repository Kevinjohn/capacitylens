/** Read the actual URL sent by the test SMTP transport, after MIME transfer decoding. */
export function readJoiningLinkFromMail(raw: string, accountId: string): URL | null {
  const separator = /\r?\n\r?\n/.exec(raw);
  if (!separator || separator.index === undefined) return null;
  const headers = raw.slice(0, separator.index);
  const body = raw.slice(separator.index + separator[0].length);
  const encoding = /(?:^|\r?\n)content-transfer-encoding:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase();
  const text =
    encoding === "quoted-printable"
      ? decodeQuotedPrintable(body)
      : encoding === "base64"
        ? Buffer.from(body, "base64").toString("utf8")
        : body;
  const match = text.match(/https?:\/\/[^\s<>]+\/join\/[^\s<>#]+#token=[A-Za-z0-9_-]+/);
  if (!match) return null;
  const link = new URL(match[0]);
  return link.pathname === `/join/${encodeURIComponent(accountId)}` ? link : null;
}

function decodeQuotedPrintable(body: string): string {
  const source = Buffer.from(body, "utf8");
  const bytes: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const byte = source[index];
    if (byte === undefined) break;
    if (byte !== 61) {
      bytes.push(byte);
      continue;
    }
    const first = source[index + 1];
    if (first === 10 || (first === 13 && source[index + 2] === 10)) {
      index += first === 13 ? 2 : 1;
      continue;
    }
    const hex = source.subarray(index + 1, index + 3).toString("ascii");
    if (/^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else bytes.push(byte);
  }
  return Buffer.from(bytes).toString("utf8");
}
