import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimeOffForm } from "./TimeOffForm";
import { useStore } from "../../store/useStore";
import { resetStoreWithAccount, setPlaceholdersEnabled, WORKDAYS } from "../../test/fixtures";

const personDraft = {
  kind: "person" as const,
  name: "Bruce Wayne",
  role: "Director",
  employmentType: "permanent" as const,
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: WORKDAYS,
  halfDays: [],
  color: "#111",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
  resetStoreWithAccount();
  setPlaceholdersEnabled(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TimeOffForm personal assignee", () => {
  it("lists only resources and keeps all personal time-off types", () => {
    useStore.getState().addResource(personDraft);
    render(<TimeOffForm onClose={() => {}} />);

    const resourcePicker = screen.getByLabelText("Resource");
    expect(resourcePicker).toHaveTextContent("Select resource");
    expect(resourcePicker).not.toHaveTextContent("Everyone");

    fireEvent.keyDown(resourcePicker, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Bruce Wayne"]);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(screen.getByLabelText("Type"), { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Holiday",
      "Sick",
      "Unpaid",
      "Other",
    ]);
  });

  it("still rejects an external resource seeded outside the picker", () => {
    const external = useStore.getState().addResource({
      ...personDraft,
      kind: "external",
      name: "Kord Industries",
      role: "Partner studio",
    });
    render(<TimeOffForm defaults={{ resourceId: external.id }} onClose={() => {}} />);

    fireEvent.keyDown(screen.getByLabelText("Resource"), { key: "ArrowDown" });
    expect(screen.queryByRole("option", { name: "Kord Industries" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/choose a resource/i);
    expect(useStore.getState().data.timeOff).toHaveLength(0);
  });
});
