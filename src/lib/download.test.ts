import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadTextFile } from "./download";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("downloadTextFile", () => {
  it("reports only that a request was dispatched and defers object-URL cleanup", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:abc");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      // At click time the anchor is in the DOM (not detached) with the right attributes.
      expect(this.getAttribute("download")).toBe("out.json");
      expect(this.getAttribute("href")).toBe("blob:abc");
      expect(document.body.contains(this)).toBe(true);
      this.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    const result = downloadTextFile("out.json", '{"a":1}');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
    expect(revokeObjectURL).not.toHaveBeenCalled(); // not synchronous — the browser is handling the request

    await new Promise((r) => setTimeout(r, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:abc");
    expect(document.querySelector('a[download="out.json"]')).toBeNull(); // cleaned up afterward
  });

  it("does not claim it can observe a cancelled anchor activation", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:abc"),
      revokeObjectURL,
    });
    const cancel = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("click", cancel, true);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      this.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    try {
      expect(downloadTextFile("out.json", "{}")).toBeUndefined();
    } finally {
      document.removeEventListener("click", cancel, true);
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('a[download="out.json"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:abc");
  });

  it("does not mistake stopped propagation for cancellation when the default remains allowed", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:abc"),
      revokeObjectURL: vi.fn(),
    });
    const stop = (event: MouseEvent) => event.stopPropagation();
    document.addEventListener("click", stop, true);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      this.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    try {
      expect(downloadTextFile("out.json", "{}")).toBeUndefined();
    } finally {
      document.removeEventListener("click", stop, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("defaults the MIME type to application/json when none is given", async () => {
    const blobSpy = vi.spyOn(globalThis, "Blob");
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:abc"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      this.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    downloadTextFile("out.json", '{"a":1}');
    await new Promise((r) => setTimeout(r, 0)); // let the deferred cleanup remove the anchor

    expect(blobSpy).toHaveBeenCalledWith(['{"a":1}'], {
      type: "application/json",
    });
  });

  it("hides the anchor so it never flashes on screen", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:abc"),
      revokeObjectURL: vi.fn(),
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.style.display).toBe("none");
      this.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    downloadTextFile("out.json", "{}");
    expect(clickSpy).toHaveBeenCalledOnce();
    await new Promise((r) => setTimeout(r, 0)); // let the deferred cleanup remove the anchor
  });

  it("throws a caller-facing error and cleans up when the click fails", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:abc"),
      revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("click blocked");
    });

    expect(() => downloadTextFile("out.json", "{}")).toThrow(
      "Could not request the download. Check your browser’s download settings and try again.",
    );
    // The half-built anchor/object-URL must be cleaned up, not leaked.
    expect(document.querySelector('a[download="out.json"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:abc");
  });

  it("cleans up safely (no secondary crash) when the failure happens before the anchor exists", () => {
    // createObjectURL throws BEFORE `a` is ever assigned, so the catch block's cleanup guards
    // (`a?.parentNode`, `url`) must hold when both are still undefined.
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        throw new Error("createObjectURL failed");
      }),
      revokeObjectURL,
    });

    expect(() => downloadTextFile("out.json", "{}")).toThrow(
      "Could not request the download. Check your browser’s download settings and try again.",
    );
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("the thrown error carries the original failure as its cause", () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:abc"),
      revokeObjectURL: vi.fn(),
    });
    const original = new Error("click blocked");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw original;
    });

    try {
      downloadTextFile("out.json", "{}");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).cause).toBe(original);
    }
  });

  it("preserves the canonical start failure when catch-path cleanup also fails", () => {
    const original = new Error("click blocked");
    const cleanupFailure = new Error("revoke failed");
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:abc"),
      revokeObjectURL: vi.fn(() => {
        throw cleanupFailure;
      }),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw original;
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      downloadTextFile("out.json", "{}");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toMatchObject({
        message: "Could not request the download. Check your browser’s download settings and try again.",
        cause: original,
      });
    }
    expect(document.querySelector('a[download="out.json"]')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith("downloadTextFile: cleanup after failed download failed", cleanupFailure);
  });

  it("warns instead of throwing when the deferred cleanup itself fails", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:abc"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      this.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    // Force the deferred cleanup's own remove() to throw, simulating a failure during teardown.
    vi.spyOn(HTMLAnchorElement.prototype, "remove").mockImplementation(() => {
      throw new Error("remove failed");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    downloadTextFile("out.json", "{}");
    await new Promise((r) => setTimeout(r, 0));

    expect(warnSpy).toHaveBeenCalledWith("downloadTextFile: cleanup after download failed", expect.any(Error));
  });
});
