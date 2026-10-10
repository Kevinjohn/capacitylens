import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ForgotPassword } from "./ForgotPassword";
import { m } from "@/i18n";

describe("ForgotPassword", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["malformed address", "address beyond the UTF-8 byte allowance"])(
    "keeps recovery feedback neutral and rejects a %s",
    async (invalidKind) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      render(<ForgotPassword />);

      fireEvent.click(screen.getByRole("button", { name: m.login_forgot_password() }));
      const email = invalidKind === "malformed address" ? "not-an-address" : `${"é".repeat(124)}@x.test`;
      fireEvent.change(screen.getByLabelText(m.login_email()), { target: { value: email } });
      fireEvent.click(screen.getByRole("button", { name: m.login_send_reset_link() }));

      expect(screen.getByRole("alert")).toHaveTextContent(m.login_failed());
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("normalizes a valid recovery address before submitting it", async () => {
    const fetch = vi.fn();
    fetch.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    render(<ForgotPassword />);

    fireEvent.click(screen.getByRole("button", { name: m.login_forgot_password() }));
    fireEvent.change(screen.getByLabelText(m.login_email()), { target: { value: "  Owner@Example.com  " } });
    fireEvent.click(screen.getByRole("button", { name: m.login_send_reset_link() }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [, request] = fetch.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({ email: "owner@example.com" });
    expect(await screen.findByRole("status")).toHaveTextContent(m.login_reset_confirmation());
  });
});
