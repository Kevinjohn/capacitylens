// Request a browser download of a text payload. Appends the anchor to the DOM (some
// browsers won't honour a click on a detached anchor) and defers revoking the object URL
// to a later task — revoking synchronously right after click() can cancel the browser's
// handling of the request. The anchor API cannot confirm that a file reached durable storage.

import { m } from "@/i18n";

function cleanupDownloadArtifacts(
  anchor: HTMLAnchorElement | undefined,
  url: string | undefined,
  warning: string,
): void {
  try {
    if (anchor?.parentNode) anchor.remove();
  } catch (error) {
    console.warn(warning, error);
  }
  try {
    if (url) URL.revokeObjectURL(url);
  } catch (error) {
    console.warn(warning, error);
  }
}

/**
 * Ask the browser to download `content` as a file named `filename`.
 *
 * A successful return means only that invoking the browser's anchor activation did not throw.
 * Event listeners, browser policy, extensions, a save prompt, or the user can still cancel the
 * request or prevent the file from being persisted; the platform exposes no reliable completion.
 *
 * @throws {Error} if creating or invoking the request throws. Callers must not describe a
 *   successful return as proof that the activation was accepted or the file was saved.
 */
export function downloadTextFile(filename: string, content: string, type = "application/json"): void {
  let url: string | undefined;
  let a: HTMLAnchorElement | undefined;
  try {
    const blob = new Blob([content], { type });
    url = URL.createObjectURL(blob);
    a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
  } catch (e) {
    // The request was not accepted. Clean up the half-built artefacts before surfacing it.
    cleanupDownloadArtifacts(a, url, "downloadTextFile: cleanup after failed download failed");
    throw new Error(m.download_start_failed(), { cause: e });
  }
  // Deferred teardown runs in its own task after the browser has received the request. A failure
  // here does not change that request outcome and would otherwise become an uncaught macrotask
  // error, so warn instead of letting it escape.
  setTimeout(() => {
    // `a`/`url` are typed `… | undefined` (declared before the try) but are always assigned by the
    // time we reach here — the catch above re-throws. Guards retain that invariant defensively.
    cleanupDownloadArtifacts(a, url, "downloadTextFile: cleanup after download failed");
  }, 0);
}
