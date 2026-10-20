import { beforeEach, describe, expect, it } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { seed } from "@capacitylens/shared/data/seed";
import { resetStoreWithAccount } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import { bootstrapDemo } from "./bootstrapDemo";

beforeEach(() => {
  resetStoreWithAccount();
});

describe("bootstrapDemo", () => {
  it("hydrates the in-memory seed and starts fresh data on a new page boot", () => {
    const initialSeed = seed();
    bootstrapDemo(useStore, initialSeed);

    expect(useStore.getState().hydrated).toBe(true);
    expect(useStore.getState().data).toEqual(initialSeed);

    const account = initialSeed.accounts[0];
    if (!account) throw new Error("expected demo seed account");
    useStore.getState().setActiveAccount(account.id);
    useStore.getState().addClient({ name: "Temporary visitor edit", color: "#111111" });
    expect(useStore.getState().data.clients.some((client) => client.name === "Temporary visitor edit")).toBe(true);

    bootstrapDemo(useStore, seed());

    expect(useStore.getState().data).toEqual(initialSeed);
    expect(useStore.getState().data.clients.some((client) => client.name === "Temporary visitor edit")).toBe(false);
  });

  it("hydrates an empty non-demo startup without browser persistence", () => {
    bootstrapDemo(useStore);

    expect(useStore.getState().hydrated).toBe(true);
    expect(useStore.getState().data).toEqual(emptyAppData());
  });
});
