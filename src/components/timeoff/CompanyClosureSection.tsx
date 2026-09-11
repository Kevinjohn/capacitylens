import { Fragment, useMemo } from "react";
import { CalendarOff } from "lucide-react";
import type { Closure } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { useEntityListState } from "../../hooks/useEntityListState";
import { useConfirmDelete } from "../../hooks/useConfirmDelete";
import { formatShortDate, formatShortDateRange } from "../../lib/dateDisplay";
import { resolveTimeZone, resolveWeekStart } from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useStore } from "../../store/useStore";
import { AddButton, ConfirmDialog, DeleteButton, EditButton, EmptyState } from "../common/ui";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "../ui/item";
import { ClosureForm } from "./ClosureForm";
import { buildClosureList, readCurrentTimeOffWeekStart } from "./timeOffView";

interface ClosureItemsProps {
  closures: Closure[];
  onEdit: (closure: Closure) => void;
  onDelete: (closure: Closure) => void;
}

function ClosureItems({ closures, onEdit, onDelete }: ClosureItemsProps) {
  return (
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
                <ItemDescription>{formatShortDateRange(closure.startDate, closure.endDate)}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <EditButton label={m.list_closures_edit_aria(labelContext)} onClick={() => onEdit(closure)} />
                <DeleteButton label={m.list_closures_delete_aria(labelContext)} onClick={() => onDelete(closure)} />
              </ItemActions>
            </Item>
          </Fragment>
        );
      })}
    </ItemGroup>
  );
}

export function CompanyClosureSection() {
  const data = useActiveScopedData();
  const calendarTimeZone = useStore((state) => resolveTimeZone(state.data, state.activeAccountId));
  const calendarWeekStartsOn = useStore((state) => resolveWeekStart(state.data, state.activeAccountId));
  const deleteEntity = useStore((state) => state.deleteClosure);
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useEntityListState<Closure>();
  const confirmDelete = useConfirmDelete(deleteEntity, () => setConfirming(null));
  const currentWeekStart = readCurrentTimeOffWeekStart(calendarTimeZone, calendarWeekStartsOn);
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
          <EmptyState icon={CalendarOff} description={m.list_closures_empty_desc()}>
            {m.list_closures_empty()}
          </EmptyState>
        </div>
      ) : (
        <ClosureItems closures={closures} onEdit={setEditing} onDelete={setConfirming} />
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
