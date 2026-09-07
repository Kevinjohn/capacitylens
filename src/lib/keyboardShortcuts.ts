interface BuildPrimaryShortcutInput {
  key: string;
  shift?: boolean | undefined;
  userAgent?: string | undefined;
}

const APPLE_USER_AGENT = /Macintosh|Mac OS X|iPhone|iPad|iPod/i;

function readBrowserUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

/** Format the primary application shortcut using the convention of the current client platform. */
export function buildPrimaryShortcut({
  key,
  shift = false,
  userAgent = readBrowserUserAgent(),
}: BuildPrimaryShortcutInput): string {
  const normalizedKey = key.toUpperCase();
  return APPLE_USER_AGENT.test(userAgent)
    ? `⌘${shift ? "⇧" : ""}${normalizedKey}`
    : `Ctrl+${shift ? "Shift+" : ""}${normalizedKey}`;
}

export const buildUndoShortcut = () => buildPrimaryShortcut({ key: "Z" });
export const buildRedoShortcut = () => buildPrimaryShortcut({ key: "Z", shift: true });
