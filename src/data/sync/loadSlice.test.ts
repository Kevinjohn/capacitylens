import { afterEach, describe, expect, it } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { makeAccount } from "../../test/fixtures";
import { readOfflineStateSnapshot, resetOfflineState, setOfflineReadState } from "../offline/state";
import { loadAll } from "./loadSlice";
import { SyncState } from "./state";

afterEach(() => resetOfflineState());

describe("loadAll repair write", () => {
  it("leaves a newer load's offline read-only state alone when an older repair finishes", async () => {
    const account = makeAccount({ id: "a-older" });
    // No Internal client, so the load must write a repair before it goes online.
    const payload = { ...emptyAppData(), accounts: [account] };
    const state = new SyncState("http://api.test", async () => Response.json(payload));
    let releaseRepair: () => void = () => {};
    const repairWritten = new Promise<void>((resolve) => {
      releaseRepair = resolve;
    });
    let repairStarted: () => void = () => {};
    const repairRequested = new Promise<void>((resolve) => {
      repairStarted = resolve;
    });

    const olderLoad = loadAll(
      state,
      () => {
        repairStarted();
        return repairWritten;
      },
      account.id,
    );
    await repairRequested;

    // A newer load starts and falls back to a cached slice, which is read-only.
    state.loadGen += 1;
    setOfflineReadState("tenant", true, 123);

    releaseRepair();
    await olderLoad;
    expect(readOfflineStateSnapshot().readOnly).toBe(true);
  });
});
