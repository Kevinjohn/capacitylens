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

const chooseOption = (field: string, option: string) => {
  fireEvent.keyDown(screen.getByLabelText(field), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: option }));
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

describe("TimeOffForm company-wide assignee", () => {
  it("keeps a new entry unassigned by default and lists Everyone first", () => {
    useStore.getState().addResource(personDraft);
    render(<TimeOffForm onClose={() => {}} />);

    const resourcePicker = screen.getByLabelText("Resource");
    expect(resourcePicker).toHaveTextContent("Select resource");
    expect(resourcePicker).not.toHaveTextContent("Everyone");

    fireEvent.keyDown(resourcePicker, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Everyone", "Bruce Wayne"]);
  });

  it("creates Everyone time off and limits its type choices to Holiday and Other", () => {
    useStore.getState().addResource(personDraft);
    render(<TimeOffForm onClose={() => {}} />);

    chooseOption("Resource", "Everyone");
    fireEvent.keyDown(screen.getByLabelText("Type"), { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Holiday", "Other"]);
    fireEvent.click(screen.getByRole("option", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.timeOff).toHaveLength(1);
    expect(useStore.getState().data.timeOff[0]).toMatchObject({ resourceId: null, type: "other" });
  });

  it("edits personal time off to Everyone and restores all types when switching back", () => {
    const resource = useStore.getState().addResource(personDraft);
    const entry = useStore.getState().addTimeOff({
      resourceId: resource.id,
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      type: "sick",
    });
    render(<TimeOffForm timeOff={entry} onClose={() => {}} />);

    chooseOption("Resource", "Everyone");
    expect(screen.getByLabelText("Type")).toHaveTextContent("Other");

    chooseOption("Resource", "Bruce Wayne");
    fireEvent.keyDown(screen.getByLabelText("Type"), { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Holiday",
      "Sick",
      "Unpaid",
      "Other",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Sick" }));

    chooseOption("Resource", "Everyone");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().data.timeOff[0]).toMatchObject({ resourceId: null, type: "other" });
  });

  it("edits Everyone time off back to a person", () => {
    const resource = useStore.getState().addResource(personDraft);
    const entry = useStore.getState().addTimeOff({
      resourceId: null,
      startDate: "2026-12-24",
      endDate: "2026-12-24",
      type: "other",
    });
    render(<TimeOffForm timeOff={entry} onClose={() => {}} />);

    expect(screen.getByLabelText("Resource")).toHaveTextContent("Everyone");
    expect(screen.getByLabelText("Type")).toHaveTextContent("Other");
    chooseOption("Resource", "Bruce Wayne");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.timeOff[0]).toMatchObject({ resourceId: resource.id, type: "other" });
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
