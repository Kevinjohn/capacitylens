import { expect, it } from "vitest";
import { readJoiningLinkFromMail } from "../../e2e/joiningMail";

it("reads the delivered invitation and proof tokens after quoted-printable soft wrapping", () => {
  const raw = [
    "From: verify@capacitylens.dev",
    "To: barbara@example.test",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Open this link: http://localhost:8887/join/a-studio?invite=3Dinvite-sec=",
    "ret#token=3Dmail-secret",
  ].join("\r\n");
  const link = readJoiningLinkFromMail(raw, "a-studio");
  expect(link?.searchParams.get("invite")).toBe("invite-secret");
  expect(link?.hash).toBe("#token=mail-secret");
});

it("does not accept a delivered link for another company", () => {
  const raw =
    "Content-Transfer-Encoding: quoted-printable\r\n\r\nhttp://localhost:8887/join/b-studio#token=3Dmail-secret";
  expect(readJoiningLinkFromMail(raw, "a-studio")).toBeNull();
});
