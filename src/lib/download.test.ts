import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadTextFile } from './download'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('downloadTextFile', () => {
  it('appends a link with the right attrs, clicks it, then DEFERS revoking the object URL', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:abc')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      // At click time the anchor is in the DOM (not detached) with the right attributes.
      expect(this.getAttribute('download')).toBe('out.json')
      expect(this.getAttribute('href')).toBe('blob:abc')
      expect(document.body.contains(this)).toBe(true)
    })

    downloadTextFile('out.json', '{"a":1}')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled() // not synchronous — the download is still starting

    await new Promise((r) => setTimeout(r, 0))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:abc')
    expect(document.querySelector('a[download="out.json"]')).toBeNull() // cleaned up afterward
  })
})
