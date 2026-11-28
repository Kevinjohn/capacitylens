import { useRef, useState } from 'react'
import { useStore } from '@/store/useStore'
import { requestApiResponse } from '@/api/queryClient'
import { API_BULK_TIMEOUT_MS } from '@/data/requestTimeout'
import { downloadTextFile } from '@/lib/download'
import { resolveErrorMessage } from '@/lib/errorMessage'
import { readApiError } from '@/lib/readApiError'
import { m } from '@/i18n'

/** Saves the export document the server builds for the active company, reporting a refusal as an error. */
export function useExportOperation() {
  const setNotice = useStore((state) => state.setNotice)
  const activeCompanyId = useStore((state) => state.activeCompanyId)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const exportData = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      if (!activeCompanyId) throw new Error('An active company is required before exporting.')
      const response = await requestApiResponse(
        'api.company_export.show',
        { params: { companyId: activeCompanyId } },
        API_BULK_TIMEOUT_MS
      )
      if (!response.ok) {
        setNotice(
          (await readApiError(response)) ?? m.data_export_failed({ status: response.status }),
          'error'
        )
        return
      }
      downloadTextFile('capacitylens-data.json', await response.text())
    } catch (error) {
      // Report the export failure instead of suggesting that an unavailable backup was saved.
      setNotice(m.data_export_error({ error: resolveErrorMessage(error) }), 'error')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return { busy, exportData }
}
