import { useState } from "react";

/** Keep create mode and the selected edit or delete-confirmation row for an entity list. */
export function useEntityListState<T>() {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [confirming, setConfirming] = useState<T | null>(null);
  return { creating, setCreating, editing, setEditing, confirming, setConfirming };
}
