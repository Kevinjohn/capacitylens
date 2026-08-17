import { Fragment, useMemo } from "react";
import { CalendarOff, Plus } from "lucide-react";
import type { Closure } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { useCrudListState } from "../../hooks/useCrudListState";
import { useConfirmDelete } from "../../hooks/useConfirmDelete";
import { formatShortDate } from "../../lib/dateDisplay";
import { timeZoneFor, weekStartsOnFor } from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useStore } from "../../store/useStore";
import { AddButton, ConfirmDialog, DeleteButton, EditButton, EmptyState } from "../common/ui";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "../ui/item";
import { ClosureForm } from "./ClosureForm";
import { buildClosureList, currentTimeOffWeekStart } from "./timeOffView";

export function CompanyClosureSection() {
  const data = useActiveScopedData();
  const calendarTimeZone = useStore((state) => timeZoneFor(state.data, state.activeAccountId));
  const calendarWeekStartsOn = useStore((state) => weekStartsOnFor(state.data, state.activeAccountId));
  const del = useStore((state) => state.deleteClosure);
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Closure>();
  const confirmDelete = useConfirmDelete(del, () => setConfirming(null));
  const currentWeekStart = currentTimeOffWeekStart(calendarTimeZone, calendarWeekStartsOn);
  const closures = useMemo(() => buildClosureList(data.closures, currentWeekStart), [currentWeekStart, data.closures]);

  return (
    <section aria-labelledby="company-closures-heading" data-testid="company-closures-section">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="company-closures-heading" className="text-base font-semibold">
          {m.list_closures_title()}
        </h2>
        <AddButton label={m.list_closures_add()} onClick={() => setCreating(true)} />
      </div>

      {closures.length === 0 ? (
        <div data-testid="company-closures-empty">
          <EmptyState
            icon={CalendarOff}
            description={m.list_closures_empty_desc()}
            action={{
              label: m.list_closures_empty_action(),
              onClick: () => setCreating(true),
              icon: Plus,
              requiresEdit: true,
            }}
          >
            {m.list_closures_empty()}
          </EmptyState>
        </div>
      ) : (
        <ItemGroup className="rounded-md border bg-card">
          {closures.map((closure, index) => {
            const start = formatShortDate(closure.startDate);
            const end = formatShortDate(closure.endDate);
            const labelContext = { name: closure.name, start, end };
            return (
              <Fragment key={closure.id}>
                {index > 0 && <ItemSeparator />}
                <Item size="sm" role="listitem" data-testid="company-closure-row" className="rounded-none">
                  <ItemContent>
                    <ItemTitle>{closure.name}</ItemTitle>
                    <ItemDescription>
                      {start} – {end}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <EditButton label={m.list_closures_edit_aria(labelContext)} onClick={() => setEditing(closure)} />
                    <DeleteButton
                      label={m.list_closures_delete_aria(labelContext)}
                      onClick={() => setConfirming(closure)}
                    />
                  </ItemActions>
                </Item>
              </Fragment>
            );
          })}
        </ItemGroup>
      )}

      {creating && <ClosureForm onClose={() => setCreating(false)} />}
      {editing && <ClosureForm closure={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_closures_delete_title()}
          message={m.list_closures_delete_message()}
          onConfirm={() => confirmDelete(confirming.id)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </section>
  );
}
