import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JoiningPolicySection } from "./JoiningPolicySection";

describe("JoiningPolicySection", () => {
  it("lets the Owner save trimmed, canonical multiple domains for the combined policy", async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <JoiningPolicySection
        accountId="a-studio"
        role="owner"
        settings={{ policy: "invitation_only", approvedDomains: [] }}
        onSave={onSave}
      />,
    );

    await user.selectOptions(screen.getByTestId("joining-policy-select"), "approved_domains_or_invitation");
    await user.type(
      screen.getByTestId("joining-policy-domains"),
      " Staff.Example.com \n bücher.example\n staff.example.com",
    );
    await user.click(screen.getByTestId("joining-policy-save"));

    expect(onSave).toHaveBeenCalledWith({
      policy: "approved_domains_or_invitation",
      approvedDomains: ["staff.example.com", "xn--bcher-kva.example"],
    });
    expect(screen.getByText(/staff through an approved domain or a person with an invitation/i)).toBeInTheDocument();
    expect(screen.getByText(/automatically receive Viewer/i)).toBeInTheDocument();
  });

  it("lets Owner and Admin copy their company joining link", async () => {
    const writeText = vi.fn(async () => {});
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    render(
      <JoiningPolicySection accountId="a-studio" role="admin" settings={{ policy: "open", approvedDomains: [] }} />,
    );
    const link = screen.getByTestId("joining-policy-link") as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/join/a-studio`);
    await user.click(screen.getByTestId("joining-policy-copy-link"));
    expect(writeText).toHaveBeenCalledWith(link.value);
    expect(screen.getByRole("status")).toHaveTextContent("Joining link copied.");
    vi.restoreAllMocks();
  });

  it("shows the Admin the policy and every domain without edit controls", () => {
    render(
      <JoiningPolicySection
        accountId="a-studio"
        role="admin"
        settings={{ policy: "approved_domains", approvedDomains: ["example.com", "staff.example.com"] }}
      />,
    );

    expect(screen.getByTestId("joining-policy-section")).toHaveTextContent("Approved domains");
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("staff.example.com")).toBeInTheDocument();
    expect(screen.getByText(/speak to the Owner/i)).toBeInTheDocument();
    expect(screen.queryByTestId("joining-policy-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("joining-policy-save")).not.toBeInTheDocument();
  });

  it("requires at least one valid domain for a domain policy", async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <JoiningPolicySection
        accountId="a-studio"
        role="owner"
        settings={{ policy: "invitation_only", approvedDomains: [] }}
        onSave={onSave}
      />,
    );

    await user.selectOptions(screen.getByTestId("joining-policy-select"), "approved_domains");
    await user.click(screen.getByTestId("joining-policy-save"));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least one approved domain/i);
    expect(onSave).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("joining-policy-domains"), "example%2ecom");
    await user.click(screen.getByTestId("joining-policy-save"));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid domain/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps an unsaved draft and explains a failed save", async () => {
    const user = userEvent.setup();
    render(
      <JoiningPolicySection
        accountId="a-studio"
        role="owner"
        settings={{ policy: "invitation_only", approvedDomains: [] }}
        onSave={vi.fn(async () => Promise.reject(new Error("server failure")))}
      />,
    );

    await user.selectOptions(screen.getByTestId("joining-policy-select"), "open");
    await user.click(screen.getByTestId("joining-policy-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
    expect(screen.getByTestId("joining-policy-select")).toHaveValue("open");
  });
});
