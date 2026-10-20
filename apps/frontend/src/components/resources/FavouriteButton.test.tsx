import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeResource, resetStoreWithAccount } from "@/test/fixtures";
import { registerPlanningExecutor } from "@/data/planning/planningActions";
import { useStore } from "@/store/useStore";
import { FavouriteButton } from "./FavouriteButton";

let detach: (() => void) | undefined;
afterEach(() => detach?.());

describe("FavouriteButton", () => {
  it("waits for the command acknowledgement before enabling another toggle", async () => {
    resetStoreWithAccount();
    let finish!: () => void;
    detach = registerPlanningExecutor(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    render(<FavouriteButton resource={makeResource({ name: "Bruce Wayne" })} />);
    const button = screen.getByRole("button", { name: /favourite/i });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("surfaces a refused command without claiming a changed favourite", async () => {
    resetStoreWithAccount();
    detach = registerPlanningExecutor(vi.fn().mockRejectedValue(new Error("Company data changed.")));
    render(<FavouriteButton resource={makeResource({ name: "Bruce Wayne", isFavourite: false })} />);
    fireEvent.click(screen.getByRole("button", { name: /favourite/i }));
    await waitFor(() =>
      expect(useStore.getState().notice).toMatchObject({ tone: "error", message: "Company data changed." }),
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });
});
