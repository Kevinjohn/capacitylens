import { useActiveScopedData } from "../../store/useScopedData";
import { useEntityListState } from "../../hooks/useEntityListState";
import { isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from "../common/ui";
import { ClientForm } from "./ClientForm";
import type { AppData, Client } from "@capacitylens/shared/types/entities";
import { useLifecycleActions } from "../../hooks/useLifecycleActions";
import { m } from "@/i18n";
import { nameForQuotedContext } from "@capacitylens/shared/domain/privateNames";
import { Fragment, useMemo } from "react";
import { Briefcase, Plus } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { buildClientArchiveImpactCopy, safeArchiveImpact } from "../../lib/archiveImpactCopy";
import { byName } from "../../lib/displayOrder";
import { ArchivedEntitySection } from "../common/ArchivedEntitySection";

/** Build the archive-confirm message for a client, appending the descendant-count cascade warning
 *  ("this also hides N projects and M allocations") when the client has active work beneath it — so
 *  the admin sees exactly what an archive pulls out of the schedule (counts via the pure
 *  archiveImpact, which diffs the same activeOnly projection the view uses). Uses safeArchiveImpact
 *  (not archiveImpact directly) so a client that stopped being active between dialog-open and
 *  render — someone else archived it, a sync landed, an undo fired — renders the base message
 *  instead of throwing during render. */
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

export function ClientList() {
  // The built-in Internal client is a behind-the-scenes data anchor (project-less internal/all-projects
  // activities bucket under it; it can own real projects), NOT a user-managed client — so it is HIDDEN
  // from this management list. It stays a REAL, persisted client everywhere it's actually used:
  // selectable in ProjectForm's client picker, a "Filter by client" option in the scheduler, and a
  // Clients entry in the command palette (all of which read `useActiveScopedData().clients` directly,
  // not this view) — and a project under Internal still resolves its client label. See DECISIONS.md.
  const scoped = useActiveScopedData();
  const clients = useMemo(
    () => scoped.clients.filter((client) => !isBuiltinClient(client)).sort(byName),
    [scoped.clients],
  );
  // The per-row action ARCHIVES (soft-delete is reached from the inline archive section);
  // `archive` branches server/local + reloads the active slice in server mode (see useLifecycleActions).
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
