const APPLE_USER_AGENT = /Macintosh|Mac OS X|iPhone|iPad|iPod/i;

function browserUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

/** Format the primary application shortcut using the convention of the current client platform. */
export function primaryShortcut(key: string, shift = false, userAgent = browserUserAgent()): string {
  const normalizedKey = key.toUpperCase();
  return APPLE_USER_AGENT.test(userAgent)
    ? `⌘${shift ? "⇧" : ""}${normalizedKey}`
    : `Ctrl+${shift ? "Shift+" : ""}${normalizedKey}`;
}

export const undoShortcut = () => primaryShortcut("Z");
export const redoShortcut = () => primaryShortcut("Z", true);
