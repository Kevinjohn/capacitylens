import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { requireCreated } from "@/test/requireCreated";
import { resetStoreWithAccount } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import { planningActions } from "@/data/planning/planningActions";
import { ActivityForm } from "./ActivityForm";

beforeEach(() => resetStoreWithAccount());

it("omits unchanged activity kind from an edit patch", async () => {
  const user = userEvent.setup();
  const activity = requireCreated(useStore.getState().addActivity({ name: "Studio planning", kind: "internal" }));
  const onClose = vi.fn();
  const updateActivity = vi.spyOn(planningActions, "updateActivity").mockResolvedValue(undefined);

  try {
    render(<ActivityForm activity={activity} onClose={onClose} />);
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Studio planning refresh");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(updateActivity).toHaveBeenCalledOnce();
    expect(updateActivity.mock.calls[0]?.[1]).toEqual({ name: "Studio planning refresh" });
  } finally {
    updateActivity.mockRestore();
  }
});
