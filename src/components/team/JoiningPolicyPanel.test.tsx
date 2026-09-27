import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { teamAccessClient } from "../../account/teamAccessClient";
import { JoiningPolicyPanel } from "./JoiningPolicyPanel";

afterEach(() => vi.restoreAllMocks());

describe("JoiningPolicyPanel", () => {
  it("loads the current company's policy and saves an Owner edit", async () => {
    const read = vi.spyOn(teamAccessClient, "readJoiningPolicy").mockResolvedValue({
      kind: "ok", status: 200, value: { policy: "invitation_only", approvedDomains: [] },
    });
    const save = vi.spyOn(teamAccessClient, "setJoiningPolicy").mockResolvedValue({
      kind: "ok", status: 200, value: { policy: "open", approvedDomains: [] },
    });
    const user = userEvent.setup();
    render(<JoiningPolicyPanel accountId="a-studio" role="owner" />);
    await screen.findByTestId("joining-policy-select");
    expect(read).toHaveBeenCalledWith("a-studio");
    await user.selectOptions(screen.getByTestId("joining-policy-select"), "open");
    await user.click(screen.getByTestId("joining-policy-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith("a-studio", { policy: "open", approvedDomains: [] }));
  });

  it("shows an Admin the loaded policy without edit controls", async () => {
    vi.spyOn(teamAccessClient, "readJoiningPolicy").mockResolvedValue({
      kind: "ok", status: 200, value: { policy: "approved_domains", approvedDomains: ["studio.example"] },
    });
    render(<JoiningPolicyPanel accountId="a-studio" role="admin" />);
    expect(await screen.findByText("studio.example")).toBeInTheDocument();
    expect(screen.queryByTestId("joining-policy-save")).not.toBeInTheDocument();
  });

  it("offers retry after a failed read and loads fresh settings", async () => {
    const read = vi.spyOn(teamAccessClient, "readJoiningPolicy")
      .mockResolvedValueOnce({ kind: "rejected", status: 503, message: null })
      .mockResolvedValueOnce({ kind: "ok", status: 200,
        value: { policy: "open", approvedDomains: [] } });
    const user = userEvent.setup();
    render(<JoiningPolicyPanel accountId="a-studio" role="admin" />);
    expect(await screen.findByText("Could not load the joining policy.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Open registration")).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
