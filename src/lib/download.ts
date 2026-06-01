// Trigger a browser download of a text payload. Appends the anchor to the DOM (some
// browsers won't honour a click on a detached anchor) and defers revoking the object URL
// to a later task — revoking synchronously right after click() can cancel the in-flight
// download, saving an empty/truncated file (worst for the "export first" backup before an
// irreversible delete).
export function downloadTextFile(filename: string, content: string, type = 'application/json'): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 0)
}
