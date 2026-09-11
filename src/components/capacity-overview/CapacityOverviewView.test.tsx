import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCOUNT_ID, makeAccount, makeAppData, makeResource, resetStoreWithAccount } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import { CapacityOverviewView } from "./CapacityOverviewView";

vi.mock("../scheduler/useCalendarToday", () => ({ useCalendarToday: () => "2026-09-10" }));

describe("CapacityOverviewView", () => {
  beforeEach(() => resetStoreWithAccount());

  it("builds the current company overview from active scoped data", () => {
    useStore.setState({
      activeAccountId: DEFAULT_ACCOUNT_ID,
      data: makeAppData({
        accounts: [makeAccount({ schedulingMode: "days", disciplinesEnabled: false })],
        resources: [makeResource({ id: "clark", accountId: DEFAULT_ACCOUNT_ID, name: "Clark Kent" })],
      }),
    });

    render(<CapacityOverviewView />);

    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Clark Kent/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "10 Sep – 13 Sep" })).toBeInTheDocument();
  });

  it("uses the Blocks-mode explanation for an unmeasured company", () => {
    useStore.setState({
      activeAccountId: DEFAULT_ACCOUNT_ID,
      data: makeAppData({ accounts: [makeAccount({ schedulingMode: "blocks" })] }),
    });

    render(<CapacityOverviewView />);

    expect(screen.getByRole("heading", { name: "Overview needs measured capacity" })).toBeInTheDocument();
  });
});
