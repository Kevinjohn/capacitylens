// Shared helpers for the AllocationModal.*.test.tsx suites, extracted from the former
// single-file AllocationModal.test.tsx with bodies unchanged.
import { expect } from "vitest";
import type userEvent from "@testing-library/user-event";
import { useStore } from "../../../store/useStore";
import type { AppData, Weekday } from "@capacitylens/shared/types/entities";
import {
  DEFAULT_ACCOUNT_ID,
  makeActivity,
  makeAppData,
  makeClient,
  makeProject,
  makeResourceDraft,
  setPlaceholdersEnabled,
} from "../../../test/fixtures";
import { chooseOption } from "./schedulerTestKit";

export function required<T>(value: T | undefined | null, message: string): T {
  expect(value).toBeDefined();
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

export function first<T>(values: T[]): T {
  return required(values[0], "Expected a non-empty test result.");
}

export function closestForm(control: HTMLElement): HTMLFormElement {
  return required(control.closest("form"), "Expected the allocation control to belong to a form.");
}

export const ACC = DEFAULT_ACCOUNT_ID;
const originalAddAllocation = useStore.getState().addAllocation;
const originalAddAllocations = useStore.getState().addAllocations;

export function base(): AppData {
  return makeAppData({
    clients: [makeClient({ accountId: ACC, color: "#111" })],
    projects: [
      makeProject({ accountId: ACC }),
      makeProject({ id: "p2", accountId: ACC, name: "Other", color: "#06b6d4" }),
    ],
    activities: [
      makeActivity({ accountId: ACC }),
      makeActivity({ id: "t2", accountId: ACC, name: "Other activity", projectId: "p2" }),
    ],
  });
}

export function restoreStoreAllocationActions(): void {
  // Zustand state writes replace the state object while retaining action references. Restore these
  // explicitly so a spy installed in one test cannot survive on a later state object.
  useStore.setState({ addAllocation: originalAddAllocation, addAllocations: originalAddAllocations });
}

export function resetAllocationModalStore(): void {
  restoreStoreAllocationActions();
  useStore.getState().replaceAll(base());
  useStore.getState().setActiveAccount(ACC);
  // Placeholders default OFF (per-account pref). Several tests reassign to / from a placeholder
  // via the Assignee picker, which only offers placeholders when the pref is on — enable it for
  // every suite. The risk-A case (editing an allocation already ON a placeholder while the pref is
  // OFF still shows that placeholder) has its own dedicated test in AllocationModal.edit.test.tsx.
  setPlaceholdersEnabled(true);
}

export const person = (name: string) => makeResourceDraft({ name, role: "Dev", color: "#111" });

export const enableDays = (workingDays?: Weekday[]) =>
  useStore.getState().updateAccount(ACC, { schedulingMode: "days", ...(workingDays && { workingDays }) });

export const addPerson = () => useStore.getState().addResource(makeResourceDraft({ name: "Tyler", color: "#111111" }));

export const completeAssignment = async (user: ReturnType<typeof userEvent.setup>) => {
  await chooseOption(user, "Project", "Acme / Lightning");
  await chooseOption(user, "Activity", "Wireframes");
};
