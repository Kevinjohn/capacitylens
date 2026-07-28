// Trigger a browser download of a text payload. Appends the anchor to the DOM (some
// browsers won't honour a click on a detached anchor) and defers revoking the object URL
// to a later task — revoking synchronously right after click() can cancel the in-flight
// download, saving an empty/truncated file (worst for the "export first" backup before an
// irreversible delete).

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
 * Start a browser download of `content` as a file named `filename`.
 *
 * @throws {Error} if the download could not be started (Blob/URL/anchor failure).
 *   A throw means the file was **NOT saved**, so callers must treat it as a hard
 *   failure: do NOT proceed with any dependent destructive action (e.g. the
 *   "export first" backup before deleting a company — a failed backup must block
 *   the delete). The message is safe to surface directly to the user.
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
    // The download never started. Surface it so a dependent destructive action is
    // blocked — clean up the half-built artefacts first so we don't leak the object URL.
    cleanupDownloadArtifacts(a, url, "downloadTextFile: cleanup after failed download failed");
    throw new Error(m.download_start_failed(), { cause: e });
  }
  // Deferred teardown runs in its own task after the download is in flight. A failure
  // here is harmless (the file already saved on click) and would otherwise become an
  // uncaught macrotask error, so warn instead of letting it escape.
  setTimeout(() => {
    // `a`/`url` are typed `… | undefined` (declared before the try) but are always assigned by the
    // time we reach here — the catch above re-throws. Guards retain that invariant defensively.
    cleanupDownloadArtifacts(a, url, "downloadTextFile: cleanup after download failed");
  }, 0);
}
