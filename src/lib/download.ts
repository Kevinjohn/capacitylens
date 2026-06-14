// Trigger a browser download of a text payload. Appends the anchor to the DOM (some
// browsers won't honour a click on a detached anchor) and defers revoking the object URL
// to a later task — revoking synchronously right after click() can cancel the in-flight
// download, saving an empty/truncated file (worst for the "export first" backup before an
// irreversible delete).

/**
 * Start a browser download of `content` as a file named `filename`.
 *
 * @throws {Error} if the download could not be started (Blob/URL/anchor failure).
 *   A throw means the file was **NOT saved**, so callers must treat it as a hard
 *   failure: do NOT proceed with any dependent destructive action (e.g. the
 *   "export first" backup before deleting a company — a failed backup must block
 *   the delete). The message is safe to surface directly to the user.
 */
export function downloadTextFile(filename: string, content: string, type = 'application/json'): void {
  let url: string | undefined
  let a: HTMLAnchorElement | undefined
  try {
    const blob = new Blob([content], { type })
    url = URL.createObjectURL(blob)
    a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
  } catch (e) {
    // The download never started. Surface it so a dependent destructive action is
    // blocked — clean up the half-built artefacts first so we don't leak the object URL.
    if (a?.parentNode) a.remove()
    if (url) URL.revokeObjectURL(url)
    throw new Error('Could not start the download — your file was NOT saved.', { cause: e })
  }
  // Deferred teardown runs in its own task after the download is in flight. A failure
  // here is harmless (the file already saved on click) and would otherwise become an
  // uncaught macrotask error, so warn instead of letting it escape.
  setTimeout(() => {
    try {
      // `a`/`url` are typed `… | undefined` (declared before the try) but are always assigned by
      // the time we reach here — the catch above re-throws, so this line only runs after a clean
      // click(). The guards keep tsc happy without changing behaviour.
      if (a?.parentNode) a.remove()
      if (url) URL.revokeObjectURL(url)
    } catch (e) {
      console.warn('downloadTextFile: cleanup after download failed', e)
    }
  }, 0)
}
