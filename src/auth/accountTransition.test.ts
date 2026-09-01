import { beforeEach, describe, expect, it, vi } from "vitest";

const transitionAccount = vi.fn();

vi.mock("./masqueradeController", () => ({
  masqueradeController: { transitionAccount },
}));

describe("transitionAccount", () => {
  beforeEach(() => {
    transitionAccount.mockReset();
  });

  it("delegates account changes to the masquerade transition boundary", async () => {
    transitionAccount.mockResolvedValue(true);
    const boundary = await import("./accountTransition");

    await expect(boundary.transitionAccount("a-loft")).resolves.toBe(true);
    expect(transitionAccount).toHaveBeenCalledWith("a-loft");
  });

  it("delegates account clearing through the same boundary", async () => {
    transitionAccount.mockResolvedValue(false);
    const boundary = await import("./accountTransition");

    await expect(boundary.transitionAccount(null)).resolves.toBe(false);
    expect(transitionAccount).toHaveBeenCalledWith(null);
  });
});
