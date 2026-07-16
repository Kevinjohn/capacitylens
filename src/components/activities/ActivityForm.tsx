import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useActiveScopedData, useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateName } from '../../lib/validation'
import { m } from '@/i18n'
import { Button, FieldError, Modal, RequiredLegend, SegmentedControl, SelectField, TextField, type Option } from '../common/ui'
import type { Activity, ActivityKind } from '@capacitylens/shared/types/entities'

// Resolved at render (a getter, not a module-scope const) so the labels re-resolve on a locale
// switch rather than freezing to the import-time locale — per the i18n key convention (DECISIONS).
const kindOptions = (): { value: ActivityKind; label: string }[] => [
  { value: 'project', label: m.form_activity_kind_project() },
  { value: 'internal', label: m.form_activity_kind_internal() },
  { value: 'repeatable', label: m.form_activity_kind_repeatable() },
]

/** Add (no `activity`) or edit an activity. Pick a kind first: a `project` activity takes a project (and keeps
 *  its phase); `internal`/cross-project (`repeatable`) are project-less, so the project picker is hidden and their
 *  project/phase forced empty. `onClose` fires on save or cancel. */
export function ActivityForm({ activity, onClose }: { activity?: Activity; onClose: () => void }) {
  const add = useStore((s) => s.addActivity)
  const update = useStore((s) => s.updateActivity)
  const data = useActiveScopedData()
  const projects = data.projects
  const clients = data.clients
  // The RAW scoped slice, for the archived-parent label only (see projectOptions below): the demo
  // build still holds an archived project in the raw slice (so we can show its name); in server
  // mode the per-account read strips it, so the label degrades to the generic "(current, archived)".
  const raw = useScopedData()

  const [name, setName] = useState(activity?.name ?? '')
  const [kind, setKind] = useState<ActivityKind>(activity?.kind ?? 'project')
  const [projectId, setProjectId] = useState(activity?.projectId ?? '')
  // Phase UI is hidden for now, but we keep an existing activity's phase so editing an
  // activity doesn't silently ungroup it; changing the project (or kind) still clears it.
  const [phaseId, setPhaseId] = useState(activity?.phaseId ?? '')
  const { error, errorField, errorId, fail } = useFieldError()

  const projectOptions: Option[] = projects.map((p) => {
    const client = clients.find((c) => c.id === p.clientId)
    return { value: p.id, label: client ? `${client.name} / ${p.name}` : p.name }
  })
  // Editing a project-kind activity whose project is ARCHIVED: the active-only options above don't
  // contain it, so without this the select would silently blank and an unrelated edit (rename)
  // couldn't round-trip the unchanged projectId. Append the current id as a DISABLED option — it
  // stays selected/submittable as the current value (the store's unchanged-parent relaxation
  // accepts it), but can't be picked back once the user chooses an active project.
  if (activity?.projectId && !projects.some((p) => p.id === activity.projectId)) {
    const rawProject = raw.projects.find((p) => p.id === activity.projectId)
    const rawClient = rawProject && raw.clients.find((c) => c.id === rawProject.clientId)
    projectOptions.push({
      value: activity.projectId,
      label: rawProject
        ? m.list_label_archived({ name: rawClient ? `${rawClient.name} / ${rawProject.name}` : rawProject.name })
        : m.form_option_current_archived(),
      disabled: true,
    })
  }

  const onKindChange = (next: ActivityKind) => {
    setKind(next)
    // Internal/cross-project activities are project-less — drop any project/phase the form held so a
    // toggle can't submit an incoherent activity (the store would reject it anyway).
    if (next !== 'project') {
      setProjectId('')
      setPhaseId('')
    }
  }

  const onProjectChange = (v: string) => {
    setProjectId(v)
    setPhaseId('')
  }

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    // A project-specific activity MUST have a project; internal/cross-project are project-less (projectId/phaseId
    // undefined). Surface the project requirement as a field error rather than relying on the
    // store throw, so the invalid control is marked.
    if (kind === 'project' && !projectId) {
      fail('project', m.form_activity_err_project_required())
      return
    }
    const patch = {
      name: trimmed,
      kind,
      projectId: kind === 'project' ? projectId || undefined : undefined,
      phaseId: kind === 'project' ? phaseId || undefined : undefined,
    }
    // Surface a store-side rejection as a form error rather than an uncaught React error — see the
    // store CRUD contract.
    try {
      if (activity) update(activity.id, patch)
      else add(patch)
      onClose()
    } catch (e) {
      fail(null, errorMessage(e))
    }
  }

  return (
    <Modal
      title={activity ? m.form_activity_edit_title() : m.form_activity_add_title()}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {m.form_cancel()}
          </Button>
          <Button type="submit">{m.form_save()}</Button>
        </>
      }
    >
      <TextField label={m.form_activity_name_label()} value={name} onChange={setName} autoFocus required invalid={errorField === 'name'} describedById={errorId} />
      <div className="mb-3">
        <p className="mb-1.5 text-sm font-medium text-ink">{m.form_activity_kind_label()}</p>
        <SegmentedControl ariaLabel={m.form_activity_kind_aria()} value={kind} onChange={onKindChange} options={kindOptions()} />
      </div>
      {kind === 'project' && (
        <SelectField label={m.form_activity_project_label()} value={projectId} onChange={onProjectChange} options={projectOptions} placeholder={m.form_activity_select_project_placeholder()} required invalid={errorField === 'project'} describedById={errorId} />
      )}
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </Modal>
  )
}
