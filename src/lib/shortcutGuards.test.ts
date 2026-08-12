import { afterEach, describe, expect, it } from "vitest";
import { hasOpenModal, textEntryOwnsShortcut } from "./shortcutGuards";

afterEach(() => {
  document.body.replaceChildren();
});

describe("textEntryOwnsShortcut", () => {
  it("rejects missing targets, generic event targets, and non-element DOM nodes", () => {
    expect(textEntryOwnsShortcut(null)).toBe(false);
    expect(textEntryOwnsShortcut(new EventTarget())).toBe(false);
    expect(textEntryOwnsShortcut(document.createTextNode("text"))).toBe(false);
  });

  it.each(["input", "textarea", "select"])("lets a %s keep its native shortcut", (tagName) => {
    expect(textEntryOwnsShortcut(document.createElement(tagName))).toBe(true);
  });

  it("does not treat ordinary elements as text entry", () => {
    expect(textEntryOwnsShortcut(document.createElement("button"))).toBe(false);
    expect(textEntryOwnsShortcut(document.createElement("div"))).toBe(false);
  });

  it("recognises an element reported by the browser as content-editable", () => {
    const element = document.createElement("div");
    Object.defineProperty(element, "isContentEditable", { value: true });

    expect(textEntryOwnsShortcut(element)).toBe(true);
  });

  it("recognises descendants of enabled content-editable regions", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editor.append(child);
    document.body.append(editor);

    expect(textEntryOwnsShortcut(child)).toBe(true);
  });

  it.each(["", "TRUE", "plaintext-only"])("recognises the content-editable state %j", (state) => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", state);
    const child = document.createElement("span");
    editor.append(child);
    document.body.append(editor);

    expect(textEntryOwnsShortcut(child)).toBe(true);
  });

  it("does not claim a region that explicitly disables content editing", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "false");
    const child = document.createElement("span");
    editor.append(child);
    document.body.append(editor);

    expect(textEntryOwnsShortcut(editor)).toBe(false);
    expect(textEntryOwnsShortcut(child)).toBe(false);
  });

  it("honours the nearest disabled content-editable boundary inside an editable parent", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const disabledRegion = document.createElement("div");
    disabledRegion.setAttribute("contenteditable", "false");
    const child = document.createElement("span");
    disabledRegion.append(child);
    editor.append(disabledRegion);
    document.body.append(editor);

    expect(textEntryOwnsShortcut(child)).toBe(false);
  });

  it("treats content-editable values case-insensitively", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "FALSE");

    expect(textEntryOwnsShortcut(editor)).toBe(false);
  });

  it("lets an invalid content-editable value inherit from the next valid ancestor", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const invalidRegion = document.createElement("div");
    invalidRegion.setAttribute("contenteditable", "invalid");
    const child = document.createElement("span");
    invalidRegion.append(child);
    editor.append(invalidRegion);
    document.body.append(editor);

    expect(textEntryOwnsShortcut(child)).toBe(true);
  });
});

describe("hasOpenModal", () => {
  function appendModal(ariaModal: string, state?: string): HTMLElement {
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", ariaModal);
    if (state !== undefined) modal.dataset.state = state;
    document.body.append(modal);
    return modal;
  }

  it("returns false when no modal exists", () => {
    expect(hasOpenModal()).toBe(false);
  });

  it("finds an aria modal whose state is open or unspecified", () => {
    appendModal("true", "open");
    expect(hasOpenModal()).toBe(true);

    document.body.replaceChildren();
    appendModal("true");
    expect(hasOpenModal()).toBe(true);
  });

  it("excludes closed dialogs and elements that are not aria modals", () => {
    appendModal("true", "closed");
    appendModal("false", "open");

    expect(hasOpenModal()).toBe(false);
  });

  it("ignores the requested modal but still detects another open modal", () => {
    const ignored = appendModal("true", "open");

    expect(hasOpenModal(ignored)).toBe(false);
    expect(hasOpenModal(null)).toBe(true);

    const other = appendModal("true", "open");
    expect(hasOpenModal(ignored)).toBe(true);
    expect(hasOpenModal(other)).toBe(true);
  });
});
