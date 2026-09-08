import { useActiveScopedData } from "../../store/useScopedData";
import { useEntityListState } from "../../hooks/useEntityListState";
import { ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from "../common/ui";
import { ProjectForm } from "./ProjectForm";
import type { AppData, Project } from "@capacitylens/shared/types/entities";
import { archiveImpact } from "@capacitylens/shared/domain/lifecycle";
import { useLifecycleActions } from "../../hooks/useLifecycleActions";
import { m } from "@/i18n";
import { nameForQuotedContext } from "@capacitylens/shared/domain/privateNames";
import { resolveProjectColor } from "@capacitylens/shared/lib/color";
import { useStore } from "../../store/useStore";
import { resolveInternalColourMode } from "../../store/selectors";
import { Fragment, useMemo } from "react";
import { Folder, Plus } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { buildProjectArchiveImpactCopy } from "../../lib/archiveImpactCopy";
import { byName } from "../../lib/displayOrder";

/** Build the archive-confirm message for a project, appending the allocation-count cascade warning
 *  when the project has active allocations that archiving would pull out of the schedule. */
function buildProjectArchiveMessage(data: AppData, project: Project): string {
  const name = project.isPrivate === true ? nameForQuotedContext(project.name) : project.name;
  const base = m.list_projects_archive_message({ name });
  const impact = archiveImpact(data, "projects", project.id);
  return impact.phases + impact.allocations > 0 ? `${base} ${buildProjectArchiveImpactCopy(impact)}` : base;
}

// eslint-disable-next-line max-lines-per-function -- list and confirmation state must remain coordinated
export function ProjectList() {
  const data = useActiveScopedData();
  const projects = useMemo(() => [...data.projects].sort(byName), [data.projects]);
  const clients = data.clients;
  const clientsById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const internalColourMode = useStore((state) => resolveInternalColourMode(state.data, state.activeAccountId));
  // The per-row action ARCHIVES (soft-delete is reached later from Settings → Archived & deleted);
  // `archive` branches server/local + reloads the active slice in server mode (see useLifecycleActions).
  const { archive } = useLifecycleActions();
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useEntityListState<Project>();

  const resolveClientName = (id: string) => {
    const client = clientsById.get(id);
    return client?.name ?? m.list_projects_no_client();
  };

  return (
    <ListPage title={m.list_projects_title()} addLabel={m.list_projects_add()} onAdd={() => setCreating(true)}>
      {projects.length === 0 ? (
        <EmptyState
          icon={Folder}
          description={m.list_projects_empty_desc()}
          action={{
            label: m.list_projects_empty_action(),
            onClick: () => setCreating(true),
            icon: Plus,
            requiresEdit: true,
          }}
        >
          {m.list_projects_empty()}
        </EmptyState>
      ) : (
        <ItemGroup className="rounded-md border bg-card">
          {projects.map((project, index) => (
            <Fragment key={project.id}>
              {index > 0 && <ItemSeparator />}
              <Item size="sm" role="listitem" data-testid="project-row" className="rounded-none">
                <ItemContent className="flex-row items-center gap-2">
                  <ColorSwatch
                    color={resolveProjectColor(project, clientsById.get(project.clientId), internalColourMode)}
                  />
                  <span className="font-medium">{project.name}</span>
                  <span className="text-sm text-muted-foreground">· {resolveClientName(project.clientId)}</span>
                </ItemContent>
                <ItemActions>
                  <EditButton label={m.list_edit_aria({ name: project.name })} onClick={() => setEditing(project)} />
                  <DeleteButton
                    label={m.list_projects_archive_aria({ name: project.name })}
                    onClick={() => setConfirming(project)}
                  />
                </ItemActions>
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      )}

      {creating && <ProjectForm onClose={() => setCreating(false)} />}
      {editing && <ProjectForm project={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_projects_archive_title()}
          message={buildProjectArchiveMessage(data, confirming)}
          confirmLabel={m.list_archive()}
          onConfirm={() => {
            void archive("projects", confirming.id);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </ListPage>
  );
}
