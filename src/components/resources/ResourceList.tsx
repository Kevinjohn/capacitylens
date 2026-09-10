import { useState } from "react";
import type { Resource, ResourceKind } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { useEntityListState } from "../../hooks/useEntityListState";
import { useLifecycleActions } from "../../hooks/useLifecycleActions";
import { resolveResourceDisplayName } from "../../lib/metadata";
import { ConfirmDialog, ListPage } from "../common/ui";
import { ExternalForm } from "../external/ExternalForm";
import { ResourceForm } from "./ResourceForm";
import { ResourceListContent } from "./ResourceListContent";
import { useResourceListModel } from "./useResourceListModel";
import { ArchivedEntitySection } from "../common/ArchivedEntitySection";

export function ResourceList() {
  const model = useResourceListModel();
  const { archive } = useLifecycleActions();
  const { editing, setEditing, confirming, setConfirming } = useEntityListState<Resource>();
  const externalState = useEntityListState<Resource>();
  const [creatingKind, setCreatingKind] = useState<ResourceKind | null>(null);
  return (
    <ListPage
      title={m.list_resources_title()}
      addLabel={m.list_resources_add()}
      onAdd={() => setCreatingKind("person")}
    >
      <ResourceListContent
        model={model}
        onAdd={setCreatingKind}
        onEdit={setEditing}
        onRequestArchive={setConfirming}
        onAddExternal={() => externalState.setCreating(true)}
        onEditExternal={externalState.setEditing}
        onRequestExternalArchive={externalState.setConfirming}
      />
      <ArchivedEntitySection entity="resources" />
      {creatingKind && <ResourceForm kind={creatingKind} onClose={() => setCreatingKind(null)} />}
      {editing && <ResourceForm resource={editing} onClose={() => setEditing(null)} />}
      {confirming && <ArchiveDialog resource={confirming} archive={archive} onClose={() => setConfirming(null)} />}
      {externalState.creating && <ExternalForm onClose={() => externalState.setCreating(false)} />}
      {externalState.editing && (
        <ExternalForm resource={externalState.editing} onClose={() => externalState.setEditing(null)} />
      )}
      {externalState.confirming && (
        <ArchiveDialog
          resource={externalState.confirming}
          messageName={externalState.confirming.name ?? externalState.confirming.role}
          archive={archive}
          onClose={() => externalState.setConfirming(null)}
        />
      )}
    </ListPage>
  );
}

type ArchiveDialogProps = {
  resource: Resource;
  messageName?: string;
  archive: (table: "resources", id: string) => Promise<unknown> | void;
  onClose: () => void;
};

function ArchiveDialog({
  resource,
  messageName = resolveResourceDisplayName(resource),
  archive,
  onClose,
}: ArchiveDialogProps) {
  return (
    <ConfirmDialog
      title={m.list_resources_archive_title()}
      message={m.list_resources_archive_message({ name: messageName })}
      confirmLabel={m.list_archive()}
      onConfirm={() => {
        void archive("resources", resource.id);
        onClose();
      }}
      onCancel={onClose}
    />
  );
}
