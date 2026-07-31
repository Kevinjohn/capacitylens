import { afterEach, describe, expect, it, vi } from "vitest";
import { primaryShortcut, redoShortcut, undoShortcut } from "./keyboardShortcuts";
import { m } from "@/i18n";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("primaryShortcut", () => {
  it.each(["Macintosh", "iPhone", "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"])(
    "uses Apple glyphs for %s",
    (userAgent) => {
      expect(primaryShortcut("z", false, userAgent)).toBe("⌘Z");
      expect(primaryShortcut("z", true, userAgent)).toBe("⌘⇧Z");
    },
  );

  it.each(["Windows NT 10.0", "X11; Linux x86_64", ""])("uses Ctrl labels for %s", (userAgent) => {
    expect(primaryShortcut("z", false, userAgent)).toBe("Ctrl+Z");
    expect(primaryShortcut("z", true, userAgent)).toBe("Ctrl+Shift+Z");
  });

  it("defaults shift to false when the caller omits it", () => {
    expect(primaryShortcut("z", undefined, "Windows NT 10.0")).toBe("Ctrl+Z");
  });

  it("resolves the current browser's user agent when none is supplied", () => {
    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    expect(primaryShortcut("z")).toBe("⌘Z");

    vi.stubGlobal("navigator", { userAgent: "Windows NT 10.0" });
    expect(primaryShortcut("z")).toBe("Ctrl+Z");
  });

  it("falls back to Ctrl labels when no navigator is present at all", () => {
    vi.stubGlobal("navigator", undefined);
    expect(primaryShortcut("z")).toBe("Ctrl+Z");
  });

  it.each([
    ["macOS", "⌘Z"],
    ["Windows/Linux", "Ctrl+Z"],
  ])("passes the %s label through every undo-bearing English message", (_platform, shortcut) => {
    const messages = [
      m.scheduler_undo_title({ shortcut }),
      m.scheduler_redo_title({ shortcut }),
      m.form_allocation_delete_message({ shortcut }),
      m.list_resources_delete_message({ name: "Person", shortcut }),
      m.list_resources_external_delete_message({ name: "Partner", shortcut }),
      m.list_clients_delete_message({ name: "Client", shortcut }),
      m.list_projects_delete_message({ name: "Project", shortcut }),
      m.scheduler_toast_undo_hint({ shortcut }),
      m.scheduler_toast_capped({ max: 24, shortcut }),
      m.data_imported_one({ count: 1, skipped: "", shortcut }),
      m.data_imported_other({ count: 2, skipped: "", shortcut }),
      m.data_import_confirm_outro({ shortcut }),
    ];

    expect(messages).toHaveLength(12);
    expect(messages.every((message) => message.includes(shortcut))).toBe(true);
  });
});

describe("undoShortcut / redoShortcut", () => {
  it("undoShortcut resolves the plain primary shortcut for the current platform", () => {
    vi.stubGlobal("navigator", { userAgent: "Windows NT 10.0" });
    expect(undoShortcut()).toBe("Ctrl+Z");

    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    expect(undoShortcut()).toBe("⌘Z");
  });

  it("redoShortcut resolves the shifted primary shortcut for the current platform", () => {
    vi.stubGlobal("navigator", { userAgent: "Windows NT 10.0" });
    expect(redoShortcut()).toBe("Ctrl+Shift+Z");

    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    expect(redoShortcut()).toBe("⌘⇧Z");
  });
});
