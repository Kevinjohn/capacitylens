import { useState } from 'react'

/** The create / edit / confirm-delete triple-state every list page hand-rolled
 *  (six identical copies). `editing`/`confirming` hold the row being acted on, or
 *  null. The setters are returned verbatim so call sites read exactly as before —
 *  this collapses the boilerplate without imposing a new abstraction. */
export function useCrudListState<T>() {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<T | null>(null)
  const [confirming, setConfirming] = useState<T | null>(null)
  return { creating, setCreating, editing, setEditing, confirming, setConfirming }
}
