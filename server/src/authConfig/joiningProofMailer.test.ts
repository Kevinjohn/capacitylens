import { expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => ({
  sendMail: vi.fn(async (message: { to: string; text: string }) => {
    void message;
  }),
}));
vi.mock("./microsoftProofPrimitives", () => ({
  createMailboxProofTransport: () => ({ transport: { sendMail }, from: "verify@studio.example" }),
}));

import { createJoiningProofMailer } from "./joiningProofMailer";

it("emails the same-browser proof link with the exact addressed invitation bearer", async () => {
  const mail = createJoiningProofMailer({}, new URL("https://capacity.example"));
  await mail("diana@studio.example", "mail-secret", { accountId: "a-studio", invitationToken: "invite-secret" });
  const message = sendMail.mock.lastCall?.[0];
  expect(message?.to).toBe("diana@studio.example");
  expect(message?.text).toContain("https://capacity.example/join/a-studio?invite=invite-secret#token=mail-secret");
});
