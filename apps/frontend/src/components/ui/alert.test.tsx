import { loadPlanningData } from "@/test/fixtures";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";

beforeEach(() => {
  loadPlanningData(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

describe("Alert", () => {
  it("keeps destructive body copy on the opaque danger token", () => {
    render(
      <Alert variant="destructive">
        <AlertDescription>Save failed.</AlertDescription>
      </Alert>,
    );

    expect(screen.getByRole("alert")).toHaveClass(
      "*:data-[slot=alert-description]:text-destructive",
    );
    expect(screen.getByRole("alert")).not.toHaveClass(
      "*:data-[slot=alert-description]:text-destructive/90",
    );
  });
});
