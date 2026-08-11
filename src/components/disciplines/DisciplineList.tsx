import { useStore } from "../../store/useStore";
import { useActiveScopedData } from "../../store/useScopedData";
import { useCrudListState } from "../../hooks/useCrudListState";
import { ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from "../common/ui";
import { NEUTRAL_COLOR } from "../../lib/palette";
import { DisciplineForm } from "./DisciplineForm";
import type { Discipline } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { Fragment } from "react";
import { Plus, Tag } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { errorMessage } from "../../lib/errorMessage";
import { byName } from "../../lib/displayOrder";

export function DisciplineList() {
  const disciplines = useActiveScopedData().disciplines;
  const del = useStore((s) => s.deleteDiscipline);
  const setNotice = useStore((s) => s.setNotice);
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Discipline>();

  // Management is alphabetical for scanning; the scheduler deliberately keeps discipline sortOrder.
  const sorted = [...disciplines].sort(byName);

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
          {sorted.map((d, index) => (
            <Fragment key={d.id}>
              {index > 0 && <ItemSeparator />}
              <Item size="sm" role="listitem" data-testid="discipline-row" className="rounded-none">
                <ItemContent className="flex-row items-center gap-2">
                  <ColorSwatch color={d.color ?? NEUTRAL_COLOR} />
                  {d.name}
                </ItemContent>
                <ItemActions>
                  <EditButton label={m.list_edit_aria({ name: d.name })} onClick={() => setEditing(d)} />
                  <DeleteButton
                    label={m.list_disciplines_delete_aria({ name: d.name })}
                    onClick={() => setConfirming(d)}
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
