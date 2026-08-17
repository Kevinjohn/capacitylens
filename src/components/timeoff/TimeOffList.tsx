import { useStore } from "../../store/useStore";
import { placeholdersEnabledFor, timeZoneFor, weekStartsOnFor } from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useCrudListState } from "../../hooks/useCrudListState";
import { ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from "../common/ui";
import { formatShortDate, formatDayCount } from "../../lib/dateDisplay";
import { TimeOffForm } from "./TimeOffForm";
import { buildTimeOffGroups, currentTimeOffWeekStart } from "./timeOffView";
import type { TimeOff } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { Fragment, useMemo } from "react";
import { Calendar, Plus } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { useConfirmDelete } from "../../hooks/useConfirmDelete";

export function TimeOffList() {
  const data = useActiveScopedData();
  const resources = data.resources;
  const placeholdersEnabled = useStore((s) => placeholdersEnabledFor(s.data, s.activeAccountId));
  const calendarTimeZone = useStore((s) => timeZoneFor(s.data, s.activeAccountId));
  const calendarWeekStartsOn = useStore((s) => weekStartsOnFor(s.data, s.activeAccountId));
  const del = useStore((s) => s.deleteTimeOff);
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<TimeOff>();
  const confirmDelete = useConfirmDelete(del, () => setConfirming(null));

  const currentWeekStart = currentTimeOffWeekStart(calendarTimeZone, calendarWeekStartsOn);
  const groups = useMemo(
    () => buildTimeOffGroups(data.timeOff, resources, currentWeekStart, placeholdersEnabled),
    [currentWeekStart, data.timeOff, placeholdersEnabled, resources],
  );

  return (
    <ListPage title={m.list_timeoff_title()} addLabel={m.list_timeoff_add()} onAdd={() => setCreating(true)}>
      {groups.length === 0 ? (
        <EmptyState
          icon={Calendar}
          description={m.list_timeoff_empty_desc()}
          action={{
            label: m.list_timeoff_empty_action(),
            onClick: () => setCreating(true),
            icon: Plus,
            requiresEdit: true,
          }}
        >
          {m.list_timeoff_empty()}
        </EmptyState>
      ) : (
        <div className="space-y-6" data-testid="timeoff-groups">
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
                <h2 id={headingId} className="mb-2 text-sm font-semibold">
                  {group.name}
                </h2>
                <ItemGroup className="rounded-md border bg-card">
                  {group.entries.map((t, index) => {
                    const labelContext = {
                      name: group.name,
                      start: formatShortDate(t.startDate),
                      end: formatShortDate(t.endDate),
                    };
                    return (
                      <Fragment key={t.id}>
                        {index > 0 && <ItemSeparator />}
                        <Item size="sm" role="listitem" data-testid="timeoff-row" className="rounded-none">
                          <ItemContent>
                            <span className="text-sm text-muted-foreground">
                              {formatShortDate(t.startDate)} · {formatDayCount(t.startDate, t.endDate)}
                            </span>
                          </ItemContent>
                          <ItemActions>
                            <EditButton label={m.list_timeoff_edit_aria(labelContext)} onClick={() => setEditing(t)} />
                            <DeleteButton
                              label={m.list_timeoff_delete_aria(labelContext)}
                              onClick={() => setConfirming(t)}
                            />
                          </ItemActions>
                        </Item>
                      </Fragment>
                    );
                  })}
                </ItemGroup>
              </section>
            );
          })}
        </div>
      )}

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
