import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CompanySetup } from "./CompanySetup";

afterEach(() => vi.unstubAllGlobals());

it("asks only for company name and preserves it after a retryable failure", async () => {
  const complete = vi.fn();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Setup unavailable. Try again." }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: "wayne" }), { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  render(<CompanySetup onCreated={complete} onConflict={async () => false} onSignOut={vi.fn()} />);
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Wayne Enterprises" } });
  fireEvent.click(screen.getByRole("button", { name: "Create company" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Setup unavailable. Try again.");
  expect(screen.getByLabelText("Company name")).toHaveValue("Wayne Enterprises");
  expect(complete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Create company" }));
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ body: JSON.stringify({ name: "Wayne Enterprises" }) }),
  );
});

it("reconciles a concurrent winner once and leaves an unconfirmed refusal visible", async () => {
  const reconcile = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const created = vi.fn();
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: "First company setup is unavailable for this installation." }), {
        status: 409,
      }),
  );
  vi.stubGlobal("fetch", fetch);
  render(<CompanySetup onCreated={created} onConflict={reconcile} onSignOut={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Wayne Enterprises" } });
  fireEvent.click(screen.getByRole("button", { name: "Create company" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("First company setup is unavailable");
  expect(fetch).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Create company" }));
  await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2));
  expect(created).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(2);
});
