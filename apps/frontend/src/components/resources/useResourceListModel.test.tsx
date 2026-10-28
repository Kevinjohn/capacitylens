import { beforeEach, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { resetStoreWithAccount, makeResource, DEFAULT_ACCOUNT_ID } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import { NEUTRAL_COLOR } from "@/lib/palette";
import { useResourceListModel } from "./useResourceListModel";
beforeEach(() => resetStoreWithAccount());
it("presents an unassigned person neutrally while preserving stored blue and discipline colours", () => {
  const person = makeResource({ id: "bruce", color: "#2d75da", disciplineId: null });
  const assigned = { ...person, id: "barbara", disciplineId: "design" };
  useStore.setState((state) => ({
    data: {
      ...state.data,
      accounts: state.data.accounts.map((a) => ({ ...a, disciplinesEnabled: true })),
      resources: [person, assigned],
      disciplines: [
        {
          id: "design",
          accountId: DEFAULT_ACCOUNT_ID,
          name: "Design",
          sortOrder: 0,
          color: "#da2d92",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    },
  }));
  const { result } = renderHook(() => useResourceListModel());
  expect(result.current.resolveSwatchColor(person)).toBe(NEUTRAL_COLOR);
  expect(result.current.resolveSwatchColor(assigned)).toBe("#da2d92");
  expect(useStore.getState().data.resources[0]?.color).toBe("#2d75da");
});
