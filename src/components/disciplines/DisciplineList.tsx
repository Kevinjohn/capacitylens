import { useStore } from "../../store/useStore";
import { useActiveScopedData } from "../../store/useScopedData";
import { useCrudListState } from "../../hooks/useCrudListState";
import { ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from "../common/ui";
import { NEUTRAL_COLOR } from "../../lib/palette";
import { DisciplineForm } from "./DisciplineForm";
import type { Discipline } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { Fragment, useMemo } from "react";
import { Plus, Tag } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { byName } from "../../lib/displayOrder";
import { useConfirmDelete } from "../../hooks/useConfirmDelete";

export function DisciplineList() {
  const disciplines = useActiveScopedData().disciplines;
  const deleteEntity = useStore((state) => state.deleteDiscipline);
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Discipline>();
  const confirmDelete = useConfirmDelete(deleteEntity, () => setConfirming(null));

  // Management is alphabetical for scanning; the scheduler deliberately keeps discipline sortOrder.
  const sorted = useMemo(() => [...disciplines].sort(byName), [disciplines]);

  return (
    <ListPage title={m.list_disciplines_title()} addLabel={m.list_disciplines_add()} onAdd={() => setCreating(true)}>
      {sorted.length === 0 ? (
        <EmptyState
          icon={Tag}
          description={m.list_disciplines_empty_desc()}
          action={{
            label: m.list_disciplines_empty_action(),
            onClick: () => setCreating(true),
            icon: Plus,
            requiresEdit: true,
          }}
        >
          {m.list_disciplines_empty()}
        </EmptyState>
      ) : (
        <ItemGroup className="rounded-md border bg-card">
          {sorted.map((discipline, index) => (
            <Fragment key={discipline.id}>
              {index > 0 && <ItemSeparator />}
              <Item size="sm" role="listitem" data-testid="discipline-row" className="rounded-none">
                <ItemContent className="flex-row items-center gap-2">
                  <ColorSwatch color={discipline.color ?? NEUTRAL_COLOR} />
                  {discipline.name}
                </ItemContent>
                <ItemActions>
                  <EditButton
                    label={m.list_edit_aria({ name: discipline.name })}
                    onClick={() => setEditing(discipline)}
                  />
                  <DeleteButton
                    label={m.list_disciplines_delete_aria({ name: discipline.name })}
                    onClick={() => setConfirming(discipline)}
                  />
                </ItemActions>
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      )}

      {creating && <DisciplineForm onClose={() => setCreating(false)} />}
      {editing && <DisciplineForm discipline={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_disciplines_delete_title()}
          message={m.list_disciplines_delete_message({ name: confirming.name })}
          onConfirm={() => confirmDelete(confirming.id)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </ListPage>
  );
}
