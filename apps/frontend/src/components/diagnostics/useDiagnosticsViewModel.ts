import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, scopedRouteQuery } from '@/api/queryClient'
import { useQueryScope } from '@/api/useQueryScope'
import { formatDiagnostics, readBrowserDiagnostics, readDiagnostics } from '@/data/buildInfo'
import { readServerDiagnostics } from '@/data/serverDiagnostics'

type ServerObservation = { response: unknown; observedAt: string | undefined }
const EMPTY_OBSERVATION: ServerObservation = { response: null, observedAt: undefined }

/** Observes the server once, then combines that snapshot with this client's live facts. */
export function useDiagnosticsViewModel() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const scope = useQueryScope()
  // One observation per view: the cache keeps nothing once the view closes.
  const { data: observation = EMPTY_OBSERVATION } = useQuery<ServerObservation>(
    scopedRouteQuery(
      api.api.diagnostics.show.queryOptions(),
      scope,
      async ({ signal }) => {
        try {
          return await readServerDiagnostics(signal)
        } catch (failure) {
          // An unavailable diagnostics read is itself represented in the fixed projection. The
          // caught error is intentionally not rendered or copied, because it may contain internals.
          if (signal.aborted) throw failure
          return { response: null, observedAt: new Date().toISOString() }
        }
      },
      {
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      }
    )
  )
  const report = formatDiagnostics(
    readDiagnostics(observation.response, observation.observedAt, {
      browser: readBrowserDiagnostics(),
    })
  )
  const copyReport = async () => {
    try {
      if (!('clipboard' in navigator) || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('Clipboard unavailable.')
      }
      await navigator.clipboard.writeText(report)
      setCopyState('copied')
    } catch {
      // Clipboard failures are reflected in the copy state shown by the view.
      setCopyState('failed')
    }
  }
  return { report, copyState, copyReport }
}
