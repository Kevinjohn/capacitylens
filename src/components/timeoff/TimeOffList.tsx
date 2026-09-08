import { useStore } from "../../store/useStore";
import { hasPlaceholdersEnabled, resolveTimeZone, resolveWeekStart } from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useEntityListState } from "../../hooks/useEntityListState";
import { AddButton, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from "../common/ui";
import { formatShortDate, formatDayCount } from "../../lib/dateDisplay";
import { TimeOffForm } from "./TimeOffForm";
import { buildTimeOffGroups, readCurrentTimeOffWeekStart, type TimeOffGroup } from "./timeOffView";
import type { TimeOff } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { Fragment, useMemo } from "react";
import { Calendar, Plus } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { useConfirmDelete } from "../../hooks/useConfirmDelete";
import { CompanyClosureSection } from "./CompanyClosureSection";

interface PersonalTimeOffSectionProps {
  groups: TimeOffGroup[];
  onAdd: () => void;
  onEdit: (timeOff: TimeOff) => void;
  onDelete: (timeOff: TimeOff) => void;
}

function PersonalTimeOffSection({ groups, onAdd, onEdit, onDelete }: PersonalTimeOffSectionProps) {
  return (
    <section aria-labelledby="personal-timeoff-heading">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="personal-timeoff-heading" className="text-base font-semibold">
          {m.list_timeoff_personal_title()}
        </h2>
        <AddButton label={m.list_timeoff_add()} onClick={onAdd} />
      </div>
      {groups.length === 0 ? (
        <EmptyState
          icon={Calendar}
          description={m.list_timeoff_empty_desc()}
          action={{ label: m.list_timeoff_empty_action(), onClick: onAdd, icon: Plus, requiresEdit: true }}
        >
          {m.list_timeoff_empty()}
        </EmptyState>
      ) : (
        <TimeOffGroups groups={groups} onEdit={onEdit} onDelete={onDelete} />
      )}
    </section>
  );
}

function TimeOffGroups({ groups, onEdit, onDelete }: Omit<PersonalTimeOffSectionProps, "onAdd">) {
  return (
    <div className="flex flex-col gap-6" data-testid="timeoff-groups">
      {groups.map((group) => {
        const groupKey = group.kind === "resource" ? `resource-${group.resourceId}` : group.kind;
        const headingId = `timeoff-group-${encodeURIComponent(groupKey)}`;
        return (
          <section
            key={groupKey}
            aria-labelledby={headingId}
            data-testid="timeoff-group"
            data-group-kind={group.kind}
            data-resource-id={group.kind === "resource" ? group.resourceId : undefined}
          >
            <h3 id={headingId} className="mb-2 text-sm font-semibold">
              {group.name}
            </h3>
            <ItemGroup className="rounded-md border bg-card">
              {group.entries.map((timeOffEntry, index) => (
                <TimeOffItem
                  key={timeOffEntry.id}
                  timeOff={timeOffEntry}
                  resourceName={group.name}
                  separated={index > 0}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </ItemGroup>
          </section>
        );
      })}
    </div>
  );
}

interface TimeOffItemProps {
  timeOff: TimeOff;
  resourceName: string;
  separated: boolean;
  onEdit: (timeOff: TimeOff) => void;
  onDelete: (timeOff: TimeOff) => void;
}

function TimeOffItem({ timeOff, resourceName, separated, onEdit, onDelete }: TimeOffItemProps) {
  const labelContext = {
    name: resourceName,
    start: formatShortDate(timeOff.startDate),
    end: formatShortDate(timeOff.endDate),
  };
  return (
    <Fragment>
      {separated && <ItemSeparator />}
      <Item size="sm" role="listitem" data-testid="timeoff-row" className="rounded-none">
        <ItemContent>
          <span className="text-sm text-muted-foreground">
            {formatShortDate(timeOff.startDate)} · {formatDayCount(timeOff.startDate, timeOff.endDate)}
          </span>
        </ItemContent>
        <ItemActions>
          <EditButton label={m.list_timeoff_edit_aria(labelContext)} onClick={() => onEdit(timeOff)} />
          <DeleteButton label={m.list_timeoff_delete_aria(labelContext)} onClick={() => onDelete(timeOff)} />
        </ItemActions>
      </Item>
    </Fragment>
  );
}

export function TimeOffList() {
  const data = useActiveScopedData();
  const resources = data.resources;
  const placeholdersEnabled = useStore((state) => hasPlaceholdersEnabled(state.data, state.activeAccountId));
  const calendarTimeZone = useStore((state) => resolveTimeZone(state.data, state.activeAccountId));
  const calendarWeekStartsOn = useStore((state) => resolveWeekStart(state.data, state.activeAccountId));
  const deleteEntity = useStore((state) => state.deleteTimeOff);
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useEntityListState<TimeOff>();
  const confirmDelete = useConfirmDelete(deleteEntity, () => setConfirming(null));

  const currentWeekStart = readCurrentTimeOffWeekStart(calendarTimeZone, calendarWeekStartsOn);
  const groups = useMemo(
    () =>
      buildTimeOffGroups({
        timeOff: data.timeOff,
        resources: resources,
        weekStart: currentWeekStart,
        placeholdersEnabled: placeholdersEnabled,
      }),
    [currentWeekStart, data.timeOff, placeholdersEnabled, resources],
  );

  return (
    <ListPage title={m.list_timeoff_title()}>
      <div className="flex flex-col gap-8">
        <CompanyClosureSection />
        <PersonalTimeOffSection
          groups={groups}
          onAdd={() => setCreating(true)}
          onEdit={setEditing}
          onDelete={setConfirming}
        />
      </div>

      {creating && <TimeOffForm onClose={() => setCreating(false)} />}
      {editing && <TimeOffForm timeOff={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_timeoff_delete_title()}
          message={m.list_timeoff_delete_message()}
          onConfirm={() => confirmDelete(confirming.id)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </ListPage>
  );
}
