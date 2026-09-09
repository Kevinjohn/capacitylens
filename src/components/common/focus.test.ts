import { beforeEach, describe, expect, it } from "vitest";
import { restoreFocus } from "./focus";

describe("restoreFocus", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("returns focus to a connected trigger", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);

    restoreFocus(trigger);

    expect(document.activeElement).toBe(trigger);
  });

  it.each([null, document.createElement("button")])(
    "falls back to the main landmark when the trigger is %s",
    (trigger) => {
      const main = document.createElement("main");
      document.body.append(main);

      restoreFocus(trigger);

      expect(main).toHaveAttribute("tabindex", "-1");
      expect(document.activeElement).toBe(main);
    },
  );

  it("does not throw when there is no main landmark", () => {
    expect(() => restoreFocus(null)).not.toThrow();
  });
});
