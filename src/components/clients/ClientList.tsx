import { useActiveScopedData } from "@/store/useScopedData";
import { useEntityListState } from "@/hooks/useEntityListState";
import { isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from "@/components/common/ui";
import { ClientForm } from "./ClientForm";
import type { AppData, Client } from "@capacitylens/shared/types/entities";
import { useLifecycleActions } from "@/hooks/useLifecycleActions";
import { m } from "@/i18n";
import { nameForQuotedContext } from "@capacitylens/shared/domain/privateNames";
import { Fragment, useMemo } from "react";
import { Briefcase, Plus } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "@/components/ui/item";
import { buildClientArchiveImpactCopy, safeArchiveImpact } from "@/lib/archiveImpactCopy";
import { byName } from "@/lib/displayOrder";
import { ArchivedEntitySection } from "@/components/common/ArchivedEntitySection";

// Render the base archive message if the row became inactive after the dialog opened; safeArchiveImpact prevents a render-time integrity throw.
function buildClientArchiveMessage(data: AppData, client: Client): string {
  const name = client.isPrivate === true ? nameForQuotedContext(client.name) : client.name;
  const base = m.list_clients_archive_message({ name });
  const impact = safeArchiveImpact(data, "clients", client.id);
  if (!impact) return base;
  const { projects, phases, allocations } = impact;
  return projects + phases + allocations > 0 ? `${base} ${buildClientArchiveImpactCopy(impact)}` : base;
}

interface ClientItemsProps {
  clients: Client[];
  onEdit: (client: Client) => void;
  onArchive: (client: Client) => void;
}

function ClientItems({ clients, onEdit, onArchive }: ClientItemsProps) {
  return (
    <ItemGroup className="rounded-md border bg-card">
      {clients.map((client, index) => (
        <Fragment key={client.id}>
          {index > 0 && <ItemSeparator />}
          <Item size="sm" role="listitem" data-testid="client-row" className="rounded-none">
            <ItemContent className="flex-row items-center gap-2">
              <ColorSwatch color={client.color} />
              {client.name}
            </ItemContent>
            <ItemActions>
              <EditButton label={m.list_edit_aria({ name: client.name })} onClick={() => onEdit(client)} />
              <DeleteButton
                label={m.list_clients_archive_aria({ name: client.name })}
                onClick={() => onArchive(client)}
              />
            </ItemActions>
          </Item>
        </Fragment>
      ))}
    </ItemGroup>
  );
}

/** Lists scoped clients while keeping the internal data anchor out of ordinary management. */
export function ClientList() {
  // The Internal client is a persisted bucket available to project and schedule selection, while ordinary client management hides it.
  const scoped = useActiveScopedData();
  const clients = useMemo(
    () => scoped.clients.filter((client) => !isBuiltinClient(client)).sort(byName),
    [scoped.clients],
  );

  const { archive } = useLifecycleActions();
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useEntityListState<Client>();

  return (
    <ListPage title={m.list_clients_title()} addLabel={m.list_clients_add()} onAdd={() => setCreating(true)}>
      {clients.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          description={m.list_clients_empty_desc()}
          action={{
            label: m.list_clients_empty_action(),
            onClick: () => setCreating(true),
            icon: Plus,
            requiresEdit: true,
          }}
        >
          {m.list_clients_empty()}
        </EmptyState>
      ) : (
        <ClientItems clients={clients} onEdit={setEditing} onArchive={setConfirming} />
      )}

      <ArchivedEntitySection entity="clients" />

      {creating && <ClientForm onClose={() => setCreating(false)} />}
      {editing && <ClientForm client={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_clients_archive_title()}
          message={buildClientArchiveMessage(scoped, confirming)}
          confirmLabel={m.list_archive()}
          onConfirm={() => {
            void archive("clients", confirming.id);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </ListPage>
  );
}
