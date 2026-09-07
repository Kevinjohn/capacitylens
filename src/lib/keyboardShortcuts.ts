const APPLE_USER_AGENT = /Macintosh|Mac OS X|iPhone|iPad|iPod/i;

function readBrowserUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

/** Format the primary application shortcut using the convention of the current client platform. */
export function buildPrimaryShortcut(key: string, shift = false, userAgent = readBrowserUserAgent()): string {
  const normalizedKey = key.toUpperCase();
  return APPLE_USER_AGENT.test(userAgent)
    ? `⌘${shift ? "⇧" : ""}${normalizedKey}`
    : `Ctrl+${shift ? "Shift+" : ""}${normalizedKey}`;
}

export const buildUndoShortcut = () => buildPrimaryShortcut("Z");
export const buildRedoShortcut = () => buildPrimaryShortcut("Z", true);
