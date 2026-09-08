import { useStore } from "../../store/useStore";
import { useActiveScopedData } from "../../store/useScopedData";
import { useEntityListState } from "../../hooks/useEntityListState";
import { ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from "../common/ui";
import { ActivityForm } from "./ActivityForm";
import type { Activity } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { Fragment, useEffect, useMemo, useRef } from "react";
import { ClipboardCheck, Plus } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { buildActivityListModel } from "./activityListModel";
import { useConfirmDelete } from "../../hooks/useConfirmDelete";

interface BoxInput {
  rows: Activity[];
  empty: string;
  testid: string;
  enrich?: { description: string; action: { label: string; onClick: () => void } } | undefined;
}

interface ActivityRowProps {
  activity: Activity;
  selectedActivityId?: string;
  selectedRowRef: React.RefObject<HTMLDivElement | null>;
  onEdit: (activity: Activity) => void;
  onDelete: (activity: Activity) => void;
}

function ActivityRow({ activity, selectedActivityId, selectedRowRef, onEdit, onDelete }: ActivityRowProps) {
  const selected = activity.id === selectedActivityId;
  return (
    <Item
      ref={selected ? selectedRowRef : undefined}
      size="sm"
      role="listitem"
      data-testid="activity-row"
      aria-current={selected ? "location" : undefined}
      tabIndex={selected ? -1 : undefined}
      className="rounded-none"
    >
      <ItemContent>
        <span className="font-medium">{activity.name}</span>
      </ItemContent>
      <ItemActions>
        <EditButton label={m.list_edit_aria({ name: activity.name })} onClick={() => onEdit(activity)} />
        <DeleteButton
          label={m.list_activities_delete_aria({ name: activity.name })}
          onClick={() => onDelete(activity)}
        />
      </ItemActions>
    </Item>
  );
}

function ActivityBox({
  rows,
  empty,
  testid,
  enrich,
  renderRow,
}: BoxInput & { renderRow: (activity: Activity) => React.ReactNode }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        {...(enrich ? { icon: ClipboardCheck } : {})}
        {...(enrich?.description !== undefined ? { description: enrich.description } : {})}
        {...(enrich?.action ? { action: { ...enrich.action, icon: Plus, requiresEdit: true } } : {})}
      >
        {empty}
      </EmptyState>
    );
  }
  return (
    <ItemGroup data-testid={testid} className="rounded-md border bg-card">
      {rows.map((activity, index) => (
        <Fragment key={activity.id}>
          {index > 0 && <ItemSeparator />}
          {renderRow(activity)}
        </Fragment>
      ))}
    </ItemGroup>
  );
}

function ProjectActivities({
  clients,
  renderRow,
}: {
  clients: ReturnType<typeof buildActivityListModel>["clients"];
  renderRow: (activity: Activity) => React.ReactNode;
}) {
  if (clients.length === 0) return <EmptyState>{m.list_activities_project_empty()}</EmptyState>;
  return (
    <div data-testid="project-specific-activities" className="space-y-6">
      {clients.map((client) => (
        <section key={client.key} className="space-y-3">
          <h3 className="text-base font-semibold">{client.name}</h3>
          <div className="space-y-4">
            {client.projects.map((project) => (
              <section key={project.key} className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">{project.name}</h4>
                <ItemGroup className="rounded-md border bg-card">
                  {project.activities.map((activity, rowIndex) => (
                    <Fragment key={activity.id}>
                      {rowIndex > 0 && <ItemSeparator />}
                      {renderRow(activity)}
                    </Fragment>
                  ))}
                </ItemGroup>
              </section>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface ActivitySectionsProps {
  model: ReturnType<typeof buildActivityListModel>;
  activityCount: number;
  onCreate: () => void;
  renderRow: (activity: Activity) => React.ReactNode;
}

function ActivitySections({ model, activityCount, onCreate, renderRow }: ActivitySectionsProps) {
  const box = (input: BoxInput) => <ActivityBox {...input} renderRow={renderRow} />;
  return model.kindOrder.map((kind, index) => {
    const headingClassName = `mb-4 flex items-center justify-between${index > 0 ? " mt-8" : ""}`;
    if (kind === "internal") {
      return (
        <Fragment key={kind}>
          <div className={headingClassName}>
            <h2 className="text-lg font-semibold">{m.list_activities_internal_heading()}</h2>
          </div>
          {box({
            rows: model.internal,
            empty: m.list_activities_internal_empty(),
            testid: "internal-activities",
            enrich:
              activityCount === 0
                ? {
                    description: m.list_activities_empty_desc(),
                    action: { label: m.list_activities_empty_action(), onClick: onCreate },
                  }
                : undefined,
          })}
        </Fragment>
      );
    }
    if (kind === "repeatable") {
      return (
        <Fragment key={kind}>
          <div className={headingClassName}>
            <h2 className="text-lg font-semibold">{m.list_activities_repeatable_heading()}</h2>
          </div>
          {box({
            rows: model.crossProject,
            empty: m.list_activities_repeatable_empty(),
            testid: "cross-project-activities",
          })}
        </Fragment>
      );
    }
    return (
      <Fragment key={kind}>
        <div className={headingClassName}>
          <h2 className="text-lg font-semibold">{m.list_activities_project_heading()}</h2>
        </div>
        <ProjectActivities clients={model.clients} renderRow={renderRow} />
      </Fragment>
    );
  });
}

export function ActivityList({ selectedActivityId }: { selectedActivityId?: string }) {
  const data = useActiveScopedData();
  const activities = data.activities;
  const projects = data.projects;
  const clients = data.clients;
  const deleteEntity = useStore((state) => state.deleteActivity);
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useEntityListState<Activity>();
  const confirmDelete = useConfirmDelete(deleteEntity, () => setConfirming(null));
  const selectedRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedRowRef.current?.focus();
  }, [selectedActivityId, activities]);

  const activityList = useMemo(
    () =>
      buildActivityListModel({
        activities,
        projects,
        clients,
        unavailableClient: m.list_activities_unavailable_client(),
        unavailableProject: m.list_activities_unavailable_project(),
      }),
    [activities, clients, projects],
  );

  const renderRow = (activity: Activity) => (
    <ActivityRow
      activity={activity}
      selectedActivityId={selectedActivityId}
      selectedRowRef={selectedRowRef}
      onEdit={setEditing}
      onDelete={setConfirming}
    />
  );

  return (
    <ListPage title={m.list_activities_title()} addLabel={m.list_activities_add()} onAdd={() => setCreating(true)}>
      <ActivitySections
        model={activityList}
        activityCount={activities.length}
        onCreate={() => setCreating(true)}
        renderRow={renderRow}
      />

      {creating && <ActivityForm onClose={() => setCreating(false)} />}
      {editing && <ActivityForm activity={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_activities_delete_title()}
          message={m.list_activities_delete_message({ name: confirming.name })}
          onConfirm={() => confirmDelete(confirming.id)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </ListPage>
  );
}
