import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
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

  it("gates the application on a connection error", () => {
    render(<AppEntryGate {...baseProps} connectionError />);

    expect(screen.getByRole("heading", { name: "Can’t reach the server" })).toBeInTheDocument();
    expect(screen.queryByText("application shell")).not.toBeInTheDocument();
  });

  it("routes unreadable local data to recovery rather than the server retry loop", async () => {
    render(<AppEntryGate {...baseProps} loadError />);

    expect(await screen.findByRole("heading", { name: "Stored data could not be read" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download raw copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset data" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Can’t reach the server" })).not.toBeInTheDocument();
    expect(screen.queryByText("application shell")).not.toBeInTheDocument();
  });

  it("focuses the retry action when the connection-error stage appears", () => {
    let callback: FrameRequestCallback | undefined;
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return 17;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    try {
      render(<AppEntryGate {...baseProps} connectionError />);
      act(() => callback?.(0));

      expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
    } finally {
      request.mockRestore();
      cancel.mockRestore();
    }
  });

  it("cancels a stale stage focus frame when the application mounts", () => {
    const request = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(23);
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    try {
      const view = render(<AppEntryGate {...baseProps} connectionError />);
      view.rerender(<AppEntryGate {...baseProps} />);

      expect(cancel).toHaveBeenCalledWith(23);
    } finally {
      request.mockRestore();
      cancel.mockRestore();
    }
  });
});
