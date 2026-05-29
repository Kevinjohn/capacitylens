import { useRef } from 'react'
import { useStore } from '../store/useStore'
import { parseData, serializeData } from '../data/transfer'

export function ImportExport() {
  const data = useStore((s) => s.data)
  const replaceAll = useStore((s) => s.replaceAll)
  const setNotice = useStore((s) => s.setNotice)
  const fileRef = useRef<HTMLInputElement>(null)

  const onExport = () => {
    const blob = new Blob([serializeData(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'floaty-data.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImport = async (file: File) => {
    try {
      replaceAll(parseData(await file.text()))
      setNotice(`Imported ${file.name}.`)
    } catch {
      setNotice('Could not import that file — it is not valid Floaty JSON.')
    }
  }

  const linkClass = 'block w-full rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-base'

  return (
    <div className="mt-6 border-t border-line pt-3">
      <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-faint">Data</div>
      <button type="button" data-testid="export-data" onClick={onExport} className={linkClass}>
        Export JSON
      </button>
      <button type="button" data-testid="import-data" onClick={() => fileRef.current?.click()} className={linkClass}>
        Import JSON
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        data-testid="import-input"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImport(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
