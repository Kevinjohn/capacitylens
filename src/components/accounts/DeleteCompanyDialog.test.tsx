import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeleteCompanyDialog } from './DeleteCompanyDialog'
import { makeAccount, makeAppData, DEFAULT_ACCOUNT_ID } from '../../test/fixtures'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import { downloadTextFile } from '../../lib/download'

// The export must be observable (not actually save files in jsdom) — mock the one download seam.
vi.mock('../../lib/download', () => ({ downloadTextFile: vi.fn() }))

// Friction on the one irreversible action: Delete stays disabled until the exact
// company name is typed.
beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
  vi.mocked(downloadTextFile).mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('DeleteCompanyDialog', () => {
  it('keeps Delete disabled until the typed name matches, then confirms', () => {
    const account = makeAccount({ name: 'Acme Co' })
    const onConfirm = vi.fn()
    render(<DeleteCompanyDialog account={account} onConfirm={onConfirm} onCancel={() => {}} />)

    const deleteBtn = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement
    expect(deleteBtn.disabled).toBe(true)

    const input = screen.getByLabelText(/Type/i)
    fireEvent.change(input, { target: { value: 'wrong' } })
    expect(deleteBtn.disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'Acme Co' } })
    expect(deleteBtn.disabled).toBe(false)

    fireEvent.click(deleteBtn)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('lets Escape abort even after typing in the confirm field (no unsaved-changes refusal)', () => {
    const account = makeAccount({ name: 'Acme Co' })
    const onCancel = vi.fn()
    render(<DeleteCompanyDialog account={account} onConfirm={() => {}} onCancel={onCancel} />)

    const input = screen.getByLabelText(/Type/i)
    fireEvent.change(input, { target: { value: 'Acme' } }) // partial — would trip the dirty guard
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
    expect(useStore.getState().notice).toBeNull() // not refused with a nonsensical "use Save" hint
  })

  it('autofocuses the type-to-confirm field, not a leading button', () => {
    const account = makeAccount({ name: 'Acme Co' })
    render(<DeleteCompanyDialog account={account} onConfirm={() => {}} onCancel={() => {}} />)
    expect(document.activeElement).toBe(screen.getByLabelText(/Type/i))
  })

  // "Export first" is the LAST backup before a no-undo cascade delete, so it must be complete
  // (server mode fetches the full ?includeInactive=1 slice) and must never silently save an empty
  // file or pretend a failed fetch produced a backup.
  describe('Export first', () => {
    const seedLocalData = () => {
      useStore.getState().replaceAll(makeAppData())
      useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)
      useStore.getState().addClient({ name: 'Acme Corp', color: '#111' })
    }

    it('DEMO build: exports the local scoped slice without any fetch', async () => {
      vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1')
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      seedLocalData()
      render(<DeleteCompanyDialog account={makeAccount()} onConfirm={() => {}} onCancel={() => {}} />)

      fireEvent.click(screen.getByRole('button', { name: 'Export first' }))

      await waitFor(() => expect(downloadTextFile).toHaveBeenCalledOnce())
      expect(fetchSpy).not.toHaveBeenCalled()
      const [, content] = vi.mocked(downloadTextFile).mock.calls[0]
      expect(content).toContain('Acme Corp')
    })

    it('DEMO build: refuses an all-empty export with a loud inline warning (no file saved)', async () => {
      vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1')
      // Account exists but carries ZERO scoped records — e.g. the slice never loaded.
      useStore.getState().replaceAll(makeAppData())
      render(<DeleteCompanyDialog account={makeAccount()} onConfirm={() => {}} onCancel={() => {}} />)

      fireEvent.click(screen.getByRole('button', { name: 'Export first' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toMatch(/no records/i)
      expect(downloadTextFile).not.toHaveBeenCalled()
    })

    it('SERVER mode: exports the fetched COMPLETE (?includeInactive=1) slice, not the store', async () => {
      // Server mode is the no-stub default. The store holds NOTHING for this company; the fetched
      // slice carries an archived client — both must still land in the export.
      const slice = makeAppData({
        clients: [
          {
            id: 'c1',
            accountId: DEFAULT_ACCOUNT_ID,
            createdAt: 't',
            updatedAt: 't',
            name: 'Archived Ghost',
            color: '#111',
            archivedAt: 't',
          },
        ],
      })
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(slice) })
      vi.stubGlobal('fetch', fetchSpy)
      render(<DeleteCompanyDialog account={makeAccount()} onConfirm={() => {}} onCancel={() => {}} />)

      fireEvent.click(screen.getByRole('button', { name: 'Export first' }))

      await waitFor(() => expect(downloadTextFile).toHaveBeenCalledOnce())
      expect(String(fetchSpy.mock.calls[0][0])).toContain('includeInactive=1')
      const [, content] = vi.mocked(downloadTextFile).mock.calls[0]
      expect(content).toContain('Archived Ghost')
    })

    it('SERVER mode: a failed fetch surfaces inline and saves NO file (backup blocks the delete step)', async () => {
      // `json` present but empty: fetchInactiveSlice best-effort reads the server's `{ error }`
      // sentence off a non-OK body (readApiError); a bodyless failure falls back to the
      // status-stamped message asserted below.
      const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
      vi.stubGlobal('fetch', fetchSpy)
      render(<DeleteCompanyDialog account={makeAccount()} onConfirm={() => {}} onCancel={() => {}} />)

      fireEvent.click(screen.getByRole('button', { name: 'Export first' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toMatch(/503/)
      expect(alert.textContent).toMatch(/do not delete/i)
      expect(downloadTextFile).not.toHaveBeenCalled()
    })

    // The fetched body is untrusted input, and it must be refused BEFORE migrate(): migrate()
    // treats the wrapperless server body as a legacy blob and synthesizes the built-in Internal
    // client from a bare accounts row, so a malformed body would otherwise defeat the zero-record
    // guard. The structural gate (every known table present as an array) refuses it instead.
    it('SERVER mode: a malformed body is refused by the structural gate (no file saved)', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve({ definitely: 'not CapacityLens' }) })
      vi.stubGlobal('fetch', fetchSpy)
      render(<DeleteCompanyDialog account={makeAccount()} onConfirm={() => {}} onCancel={() => {}} />)

      fireEvent.click(screen.getByRole('button', { name: 'Export first' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toMatch(/incomplete/i)
      expect(alert.textContent).toMatch(/do not delete/i)
      expect(downloadTextFile).not.toHaveBeenCalled()
    })

    // The nastier variant: a 200 body carrying ONLY a matching accounts row (broken proxy /
    // wrong-version server). migrate() would synthesize the Internal client from that row
    // (total ≥ 1, zero-record guard defeated) and save a nearly-empty file as the "complete
    // last backup" — the structural gate must refuse it because the scoped tables are absent.
    it('SERVER mode: a partial body (accounts row only) is refused as incomplete (no file saved)', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accounts: [{ id: DEFAULT_ACCOUNT_ID }] }),
      })
      vi.stubGlobal('fetch', fetchSpy)
      render(<DeleteCompanyDialog account={makeAccount()} onConfirm={() => {}} onCancel={() => {}} />)

      fireEvent.click(screen.getByRole('button', { name: 'Export first' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toMatch(/incomplete/i)
      expect(downloadTextFile).not.toHaveBeenCalled()
    })

    // Export is optional, but a delete must not RACE a pending export attempt (the cascade
    // would erase the very slice being backed up). Both buttons disarm while the fetch is in
    // flight; once it settles — even on failure — Delete re-arms (users may hold their own backup).
    it('disables Delete and Export while an export attempt is in flight, re-arms after it settles', async () => {
      let resolveFetch!: (v: unknown) => void
      const fetchSpy = vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))
      vi.stubGlobal('fetch', fetchSpy)
      const account = makeAccount()
      render(<DeleteCompanyDialog account={account} onConfirm={() => {}} onCancel={() => {}} />)

      // Arm Delete first so the in-flight disable is observable independently of the name gate.
      fireEvent.change(screen.getByLabelText(/Type/i), { target: { value: account.name } })
      const deleteBtn = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement
      const exportBtn = screen.getByRole('button', { name: 'Export first' }) as HTMLButtonElement
      expect(deleteBtn.disabled).toBe(false)

      fireEvent.click(exportBtn)
      await waitFor(() => expect(deleteBtn.disabled).toBe(true))
      expect(exportBtn.disabled).toBe(true)

      resolveFetch({ ok: false, status: 503, json: async () => ({}) }) // the attempt FAILS — export stays optional
      await screen.findByRole('alert')
      expect(deleteBtn.disabled).toBe(false)
      expect(exportBtn.disabled).toBe(false)
      expect(downloadTextFile).not.toHaveBeenCalled()
    })
  })
})
