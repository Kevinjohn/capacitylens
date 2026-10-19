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
    const existingInlineGap = "7px";
    document.body.style.setProperty(
      "--removed-body-scroll-bar-size",
      existingInlineGap,
    );
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

    const nestedDialog = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Choose a resource</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(document.body).toHaveAttribute("data-scroll-locked", "2");
    expect(document.querySelectorAll("style")).toHaveLength(styleCount);

    dialog.unmount();
    expect(document.body).toHaveAttribute("data-scroll-locked", "1");
    expect(
      document.body.style.getPropertyValue("--removed-body-scroll-bar-size"),
    ).toBe("24px");

    nestedDialog.unmount();

    expect(document.body).not.toHaveAttribute("data-scroll-locked");
    expect(getComputedStyle(document.body).overflow).not.toBe("hidden");
    expect(
      document.body.style.getPropertyValue("--removed-body-scroll-bar-size"),
    ).toBe(existingInlineGap);
  });
});
