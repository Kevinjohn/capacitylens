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

  it('defaults the MIME type to application/json when none is given', async () => {
    const blobSpy = vi.spyOn(globalThis, 'Blob')
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:abc'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadTextFile('out.json', '{"a":1}')
    await new Promise((r) => setTimeout(r, 0)) // let the deferred cleanup remove the anchor

    expect(blobSpy).toHaveBeenCalledWith(['{"a":1}'], { type: 'application/json' })
  })

  it('hides the anchor so it never flashes on screen', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:abc'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.style.display).toBe('none')
    })

    downloadTextFile('out.json', '{}')
    await new Promise((r) => setTimeout(r, 0)) // let the deferred cleanup remove the anchor
  })

  it('throws a caller-facing error and cleans up when the click fails', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:abc'), revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('click blocked')
    })

    expect(() => downloadTextFile('out.json', '{}')).toThrow('Could not start the download — your file was NOT saved.')
    // The half-built anchor/object-URL must be cleaned up, not leaked.
    expect(document.querySelector('a[download="out.json"]')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:abc')
  })

  it('cleans up safely (no secondary crash) when the failure happens before the anchor exists', () => {
    // createObjectURL throws BEFORE `a` is ever assigned, so the catch block's cleanup guards
    // (`a?.parentNode`, `url`) must hold when both are still undefined.
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => {
        throw new Error('createObjectURL failed')
      }),
      revokeObjectURL,
    })

    expect(() => downloadTextFile('out.json', '{}')).toThrow('Could not start the download — your file was NOT saved.')
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('the thrown error carries the original failure as its cause', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:abc'), revokeObjectURL: vi.fn() })
    const original = new Error('click blocked')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw original
    })

    try {
      downloadTextFile('out.json', '{}')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as Error).cause).toBe(original)
    }
  })

  it('warns instead of throwing when the deferred cleanup itself fails', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:abc'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    // Force the deferred cleanup's own remove() to throw, simulating a failure during teardown.
    vi.spyOn(HTMLAnchorElement.prototype, 'remove').mockImplementation(() => {
      throw new Error('remove failed')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    downloadTextFile('out.json', '{}')
    await new Promise((r) => setTimeout(r, 0))

    expect(warnSpy).toHaveBeenCalledWith('downloadTextFile: cleanup after download failed', expect.any(Error))
  })
})
