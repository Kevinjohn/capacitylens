import { describe, expect, it } from "vitest";
import { createMemberResourceCommandController } from "./memberResourceCommandController";

describe("member resource command controller", () => {
  it("locks duplicate commands synchronously and releases them once", () => {
    const controller = createMemberResourceCommandController();
    const first = controller.begin("link:account:resource");
    expect(first).not.toBeNull();
    expect(controller.begin("link:account:resource")).toBeNull();
    first?.release();
    first?.release();
    expect(controller.begin("link:account:resource")).not.toBeNull();
  });

  it("invalidates late outcomes when account or session context changes", () => {
    const controller = createMemberResourceCommandController();
    const first = controller.begin("link:account:resource");
    controller.invalidate();
    expect(first?.isCurrent()).toBe(false);
    expect(controller.begin("link:account:resource")).not.toBeNull();
  });

  it("does not let an invalidated A release remove newer B or a third command", () => {
    const controller = createMemberResourceCommandController();
    const first = controller.begin("link:account:resource");
    controller.invalidate();
    const second = controller.begin("link:account:resource");
    first?.release();
    expect(controller.begin("link:account:resource")).toBeNull();
    second?.release();
    expect(controller.begin("link:account:resource")).not.toBeNull();
  });
});
