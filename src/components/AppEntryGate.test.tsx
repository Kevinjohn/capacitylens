import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppEntryGate } from "./AppEntryGate";

const baseProps = {
  hydrated: true,
  connectionError: false,
  loadError: false,
  demoAuthActive: false,
  fakeSignedIn: true,
  hasActiveAccount: true,
  introSeen: true,
  onFakeSignIn: () => undefined,
  onIntroContinue: () => undefined,
  children: <div>application shell</div>,
};

describe("AppEntryGate connection failures", () => {
  it("shows only a neutral loading boundary before hydration completes", () => {
    render(<AppEntryGate {...baseProps} hydrated={false} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByText("application shell")).not.toBeInTheDocument();
  });

  it.each([
    ["connection error", { connectionError: true }],
    ["load error", { loadError: true }],
  ])("gates the application on a %s", (_label, errorState) => {
    render(<AppEntryGate {...baseProps} {...errorState} />);

    expect(screen.getByRole("heading", { name: "Can’t reach the server" })).toBeInTheDocument();
    expect(screen.queryByText("application shell")).not.toBeInTheDocument();
  });
});
