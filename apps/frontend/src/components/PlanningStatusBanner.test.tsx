import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlanningControllerMetadata, PlanningPendingMutation } from "@/data/planning/planningCacheController";
import { useStore } from "@/store/useStore";
import { Modal } from "./common/dialogs";
import { PlanningStatusBanner } from "./PlanningStatusBanner";

const runtime = vi.hoisted(() => ({
  attached: true,
  authMode: "off" as "off" | "password-only",
  controller: {
    reconcile: vi.fn<() => Promise<boolean>>(),
    refresh: vi.fn<() => Promise<boolean>>(),
  },
}));

vi.mock("@/data/planning/planningRuntime", () => ({
  hasPlanningRuntime: () => runtime.attached,
  getPlanningController: () => runtime.controller,
}));
vi.mock("@/auth/authContext", () => ({ useAuth: () => ({ authMode: runtime.authMode }) }));

function setFailure(kind: "unknown" | "confirmed") {
  const current = useStore.getState();
  const pending = {
    execution: {},
    ...(kind === "confirmed" ? { commitment: { revision: 2, historyEligible: true } } : {}),
  } as PlanningPendingMutation;
  const planning = {
    ...current.planning,
    context: { identity: "test", companyId: "acct-test" },
    revision: 1,
    status: "error",
    pending,
    outcome: kind === "unknown" ? { kind: "uncertain", execution: {} } : current.planning.outcome,
  } as PlanningControllerMetadata;
  useStore.setState({ persistError: true, planning });
}

beforeEach(() => {
  runtime.attached = true;
  runtime.authMode = "off";
  runtime.controller.reconcile.mockReset();
  runtime.controller.refresh.mockReset();
  useStore.setState((state) => ({
    persistError: false,
    planning: { ...state.planning, context: null, pending: null, canWrite: false, status: "idle", outcome: null },
  }));
});

afterEach(() => vi.restoreAllMocks());

describe("PlanningStatusBanner", () => {
  it("checks an unknown outcome after a failed read without replaying it and guards duplicate checks", async () => {
    setFailure("unknown");
    let finishCheck: ((result: boolean) => void) | undefined;
    runtime.controller.reconcile.mockImplementation(() => new Promise((resolve) => (finishCheck = resolve)));

    render(<PlanningStatusBanner />);

    const check = screen.getByRole("button", { name: "Check saved change" });
    fireEvent.click(check);
    expect(check).toBeDisabled();
    fireEvent.click(check);
    expect(runtime.controller.reconcile).toHaveBeenCalledTimes(1);
    expect(runtime.controller.refresh).not.toHaveBeenCalled();

    finishCheck?.(false);
    await waitFor(() => expect(check).toBeEnabled());
    expect(screen.getByText(/could not be completed/i)).toBeInTheDocument();
    expect(screen.getByTestId("planning-status-banner")).toHaveTextContent(/before trying it again/i);
  });

  it("makes lookup-only recovery available by pointer inside a retained dialog", async () => {
    const user = userEvent.setup();
    setFailure("unknown");
    runtime.controller.reconcile.mockResolvedValue(false);

    render(
      <Modal title="Retained editor" onClose={vi.fn()} recovery={<PlanningStatusBanner placement="modal" />}>
        <input aria-label="Draft name" />
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Retained editor" });
    const recovery = within(dialog).getByTestId("planning-modal-recovery");
    await user.click(within(recovery).getByRole("button", { name: "Check saved change" }));

    expect(runtime.controller.reconcile).toHaveBeenCalledOnce();
    expect(runtime.controller.refresh).not.toHaveBeenCalled();
    expect(within(dialog).queryByTestId("planning-status-banner")).not.toBeInTheDocument();
  });

  it("makes canonical refresh keyboard-accessible inside a retained dialog", async () => {
    const user = userEvent.setup();
    setFailure("confirmed");
    runtime.controller.refresh.mockResolvedValue(true);

    render(
      <Modal title="Retained editor" onClose={vi.fn()} recovery={<PlanningStatusBanner placement="modal" />}>
        <input aria-label="Draft name" />
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Retained editor" });
    const button = within(dialog).getByRole("button", { name: "Refresh company data" });
    button.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(runtime.controller.refresh).toHaveBeenCalledOnce());
    expect(runtime.controller.reconcile).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId("planning-modal-recovery")).toContainElement(button);
  });

  it("distinguishes a confirmed save and offers only canonical refresh", async () => {
    setFailure("confirmed");
    runtime.controller.reconcile.mockResolvedValue(true);
    runtime.controller.refresh.mockResolvedValue(true);

    render(<PlanningStatusBanner />);

    const banner = screen.getByTestId("planning-status-banner");
    expect(banner).toHaveTextContent(
      "Your change was saved. The latest company data could not be loaded. Check it before making another change.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh company data" }));
    await waitFor(() => expect(runtime.controller.refresh).toHaveBeenCalledOnce());
    expect(runtime.controller.reconcile).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Check saved change" })).not.toBeInTheDocument();
  });

  it("offers canonical refresh after a normal company read fails without a pending mutation", async () => {
    const current = useStore.getState();
    useStore.setState({
      persistError: true,
      planning: {
        ...current.planning,
        context: { identity: "test", companyId: "acct-test" },
        pending: null,
        status: "error",
      },
    });
    runtime.controller.refresh.mockResolvedValue(true);

    render(<PlanningStatusBanner />);

    expect(screen.getByTestId("planning-status-banner")).toHaveTextContent(
      "Company data could not be loaded. Refresh it before making another change.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh company data" }));
    await waitFor(() => expect(runtime.controller.refresh).toHaveBeenCalledOnce());
    expect(runtime.controller.reconcile).not.toHaveBeenCalled();
  });

  it("preserves the generic persistence warning when planning has no active context", () => {
    runtime.attached = true;
    const current = useStore.getState();
    useStore.setState({
      persistError: true,
      planning: { ...current.planning, context: null, pending: null, status: "error" },
    });

    render(<PlanningStatusBanner />);

    expect(screen.getByText("Changes aren’t being saved right now — we’ll keep retrying.")).toBeInTheDocument();
    expect(screen.queryByTestId("planning-status-banner")).not.toBeInTheDocument();
  });

  it("shows the auth setup notice for a read-only auth-off server context", () => {
    const current = useStore.getState();
    useStore.setState({
      planning: {
        ...current.planning,
        context: { identity: "server", companyId: "acct-test" },
        canWrite: false,
        pending: null,
        status: "ready",
      },
    });

    render(<PlanningStatusBanner />);

    const banner = screen.getByTestId("planning-readonly-auth-banner");
    expect(banner).toHaveTextContent(
      "This server is read-only because sign-in is off. Configure password or Google sign-in to edit planning data.",
    );
    expect(within(banner).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows no read-only auth notice for the context-free editable memory demo", () => {
    runtime.attached = false;
    runtime.authMode = "off";

    render(<PlanningStatusBanner />);

    expect(screen.queryByTestId("planning-readonly-auth-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("planning-status-banner")).not.toBeInTheDocument();
  });

  it("does not label an authenticated viewer as auth-off", () => {
    runtime.authMode = "password-only";
    const current = useStore.getState();
    useStore.setState({
      planning: {
        ...current.planning,
        context: { identity: "viewer", companyId: "acct-test" },
        canWrite: false,
        pending: null,
        status: "ready",
      },
    });

    render(<PlanningStatusBanner />);

    expect(screen.queryByTestId("planning-readonly-auth-banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
