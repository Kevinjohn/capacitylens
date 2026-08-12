import { useStore } from "../../store/useStore";
import { useActiveScopedData } from "../../store/useScopedData";
import { useCrudListState } from "../../hooks/useCrudListState";
import { ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from "../common/ui";
import { ActivityForm } from "./ActivityForm";
import type { Activity } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { Fragment, useEffect, useMemo, useRef } from "react";
import { ClipboardCheck, Plus } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { errorMessage } from "../../lib/errorMessage";
import { buildActivityListModel } from "./activityListModel";

export function ActivityList({ selectedActivityId = null }: { selectedActivityId?: string | null }) {
  const data = useActiveScopedData();
  const activities = data.activities;
  const projects = data.projects;
  const clients = data.clients;
  const del = useStore((s) => s.deleteActivity);
  const setNotice = useStore((s) => s.setNotice);
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Activity>();
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

  const renderRow = (activity: Activity) => {
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
          <EditButton label={m.list_edit_aria({ name: activity.name })} onClick={() => setEditing(activity)} />
          <DeleteButton
            label={m.list_activities_delete_aria({ name: activity.name })}
            onClick={() => setConfirming(activity)}
          />
        </ItemActions>
      </Item>
    );
  };

  // Three kind-sections share this box, each always rendered. To avoid three identical CTAs
  // (and the duplicate accessible-name that creates) when the account is wholly empty, the
  // icon/description/CTA are attached to ONE section only (Internal, the first) via `enrich`;
  // the other two keep just their bare message. `empty` stays the load-bearing children.
  const box = (
    rows: Activity[],
    empty: string,
    testid: string,
    enrich?: { description: string; action: { label: string; onClick: () => void } },
  ) =>
    rows.length === 0 ? (
      <EmptyState
        icon={enrich ? ClipboardCheck : undefined}
        description={enrich?.description}
        action={enrich?.action ? { ...enrich.action, icon: Plus, requiresEdit: true } : undefined}
      >
        {empty}
      </EmptyState>
    ) : (
      <ItemGroup data-testid={testid} className="rounded-md border bg-card">
        {rows.map((activity, index) => (
          <Fragment key={activity.id}>
            {index > 0 && <ItemSeparator />}
            {renderRow(activity)}
          </Fragment>
        ))}
      </ItemGroup>
    );

  const renderKindSection = (kind: (typeof activityList.kindOrder)[number], index: number) => {
    const headingClassName = `mb-4 flex items-center justify-between${index > 0 ? " mt-8" : ""}`;

    if (kind === "internal") {
      return (
        <Fragment key={kind}>
          <div className={headingClassName}>
            <h2 className="text-lg font-semibold">{m.list_activities_internal_heading()}</h2>
          </div>
          {box(
            activityList.internal,
            m.list_activities_internal_empty(),
            "internal-activities",
            activities.length === 0
              ? {
                  description: m.list_activities_empty_desc(),
                  action: { label: m.list_activities_empty_action(), onClick: () => setCreating(true) },
                }
              : undefined,
          )}
        </Fragment>
      );
    }

    if (kind === "repeatable") {
      return (
        <Fragment key={kind}>
          <div className={headingClassName}>
            <h2 className="text-lg font-semibold">{m.list_activities_repeatable_heading()}</h2>
          </div>
          {box(activityList.crossProject, m.list_activities_repeatable_empty(), "cross-project-activities")}
        </Fragment>
      );
    }

    return (
      <Fragment key={kind}>
        <div className={headingClassName}>
          <h2 className="text-lg font-semibold">{m.list_activities_project_heading()}</h2>
        </div>
        {activityList.clients.length === 0 ? (
          <EmptyState>{m.list_activities_project_empty()}</EmptyState>
        ) : (
          <div data-testid="project-specific-activities" className="space-y-6">
            {activityList.clients.map((client) => (
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
        )}
      </Fragment>
    );
  };

  return (
    <ListPage title={m.list_activities_title()} addLabel={m.list_activities_add()} onAdd={() => setCreating(true)}>
      {activityList.kindOrder.map(renderKindSection)}

      {creating && <ActivityForm onClose={() => setCreating(false)} />}
      {editing && <ActivityForm activity={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_activities_delete_title()}
          message={m.list_activities_delete_message({ name: confirming.name })}
          onConfirm={() => {
            try {
              del(confirming.id);
              setConfirming(null);
            } catch (error) {
              setNotice(errorMessage(error), "error");
            }
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </ListPage>
  );
}
