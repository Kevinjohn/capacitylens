import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import "@/index.css";

let restoreViewport: (() => void) | undefined;

afterEach(() => {
  restoreViewport?.();
  restoreViewport = undefined;
});

describe("dialog scroll locking under the application CSP", () => {
  it("locks body scrolling without injecting a style element and cleans up its measured gap", () => {
    const existingLockStyles = [
      ["--removed-body-scroll-bar-size", "7px", "important"],
      ["--scroll-lock-body-left", "2px", "important"],
      ["--scroll-lock-body-top", "3px", ""],
      ["--scroll-lock-body-right", "5px", "important"],
    ] as const;
    for (const [property, value, priority] of existingLockStyles) {
      document.body.style.setProperty(property, value, priority);
    }
    const existingLockAttributes = [
      ["data-scroll-lock-no-relative", "preserved-relative"],
      ["data-scroll-lock-gap-mode", "preserved-gap-mode"],
      ["data-scroll-lock-no-important", "preserved-priority"],
    ] as const;
    for (const [name, value] of existingLockAttributes) {
      document.body.setAttribute(name, value);
    }
    const styleCount = document.querySelectorAll("style").length;
    const clientWidth = Object.getOwnPropertyDescriptor(
      document.documentElement,
      "clientWidth",
    );
    const innerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    restoreViewport = () => {
      if (clientWidth)
        Object.defineProperty(
          document.documentElement,
          "clientWidth",
          clientWidth,
        );
      else Reflect.deleteProperty(document.documentElement, "clientWidth");
      if (innerWidth) Object.defineProperty(window, "innerWidth", innerWidth);
      else Reflect.deleteProperty(window, "innerWidth");
    };
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });

    const dialog = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Schedule work</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(
      screen.getByRole("dialog", { name: "Schedule work" }),
    ).toBeInTheDocument();
    expect(document.body).toHaveAttribute("data-scroll-locked", "1");
    expect(document.body).not.toHaveAttribute("data-scroll-lock-no-relative");
    expect(document.body).not.toHaveAttribute("data-scroll-lock-gap-mode");
    expect(document.body).not.toHaveAttribute("data-scroll-lock-no-important");
    expect(getComputedStyle(document.body).overflow).toBe("hidden");
    expect(getComputedStyle(document.body).overscrollBehavior).toBe("contain");
    const backgroundScroll = new WheelEvent("wheel", {
      deltaY: 1,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(backgroundScroll);
    expect(backgroundScroll.defaultPrevented).toBe(true);
    expect(document.querySelectorAll("style")).toHaveLength(styleCount);
    expect(
      document.body.style.getPropertyValue("--removed-body-scroll-bar-size"),
    ).toBe("24px");

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1030,
    });
    const nestedDialog = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Choose a resource</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(document.body).toHaveAttribute("data-scroll-locked", "2");
    expect(document.querySelectorAll("style")).toHaveLength(styleCount);
    expect(
      document.body.style.getPropertyValue("--removed-body-scroll-bar-size"),
    ).toBe("24px");
    expect(
      document.body.style.getPropertyValue("--scroll-lock-body-right"),
    ).toBe("0px");
    expect(document.body.style.getPropertyValue("padding-right")).toBe("");

    nestedDialog.unmount();
    expect(document.body).toHaveAttribute("data-scroll-locked", "1");
    expect(
      document.body.style.getPropertyValue("--removed-body-scroll-bar-size"),
    ).toBe("24px");
    expect(
      document.body.style.getPropertyValue("--scroll-lock-body-right"),
    ).toBe("0px");
    expect(document.body.style.getPropertyValue("padding-right")).toBe("");
    expect(document.querySelectorAll("style")).toHaveLength(styleCount);

    dialog.unmount();

    expect(document.body).not.toHaveAttribute("data-scroll-locked");
    expect(getComputedStyle(document.body).overflow).not.toBe("hidden");
    for (const [property, value, priority] of existingLockStyles) {
      expect(document.body.style.getPropertyValue(property)).toBe(value);
      expect(document.body.style.getPropertyPriority(property)).toBe(priority);
    }
    for (const [name, value] of existingLockAttributes) {
      expect(document.body).toHaveAttribute(name, value);
    }
  });
});
