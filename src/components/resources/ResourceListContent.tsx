import { Fragment } from "react";
import { Plus, Users } from "lucide-react";
import type { Resource, ResourceKind } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { AddButton, ColorSwatch, DeleteButton, EditButton, EmptyState } from "../common/ui";
import { Badge } from "../ui/badge";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { Separator } from "../ui/separator";
import { resolveResourceDisplayName } from "../../lib/metadata";
import { FavouriteButton } from "./FavouriteButton";
import { ExternalResourceSection } from "./ExternalResourceSection";
import type { ResourceListModel } from "./useResourceListModel";

type ResourceListContentProps = {
  model: ResourceListModel;
  onAdd: (kind: ResourceKind) => void;
  onEdit: (resource: Resource) => void;
  onRequestArchive: (resource: Resource) => void;
  onAddExternal: () => void;
  onEditExternal: (resource: Resource) => void;
  onRequestExternalArchive: (resource: Resource) => void;
};

export function ResourceListContent(props: ResourceListContentProps) {
  return (
    <>
      <PeopleSections {...props} />
      {props.model.placeholdersEnabled && <PlaceholderSection {...props} />}
      {props.model.externalEnabled && (
        <ExternalResourceSection
          externals={props.model.externals}
          onAdd={props.onAddExternal}
          onEdit={props.onEditExternal}
          onRequestArchive={props.onRequestExternalArchive}
        />
      )}
    </>
  );
}

function PeopleSections(props: ResourceListContentProps) {
  const { model } = props;
  if (!model.groupByEngagement || model.people.length === 0) {
    const emptyAction =
      model.visibleCount === 0
        ? {
            description: m.list_resources_empty_desc(),
            action: { label: m.list_resources_empty_action(), onClick: () => props.onAdd("person") },
          }
        : undefined;
    return (
      <ResourceRows
        rows={model.people}
        empty={m.list_resources_empty()}
        {...(emptyAction ? { enrich: emptyAction } : {})}
        {...props}
      />
    );
  }
  return (
    <>
      <EngagementSection
        id="studio-resources-heading"
        title={m.list_resources_studio_heading()}
        rows={model.studioPeople}
        empty={m.list_resources_studio_empty()}
        {...props}
      />
      <EngagementSection
        id="supplementary-resources-heading"
        title={m.list_resources_supplementary_heading()}
        rows={model.supplementaryPeople}
        empty={m.list_resources_supplementary_empty()}
        separated
        {...props}
      />
    </>
  );
}

function PlaceholderSection(props: ResourceListContentProps) {
  return (
    <>
      <Separator className="mt-8" />
      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{m.list_resources_placeholders_heading()}</h2>
        <AddButton label={m.list_resources_add_placeholder()} onClick={() => props.onAdd("placeholder")} />
      </div>
      <ResourceRows rows={props.model.placeholders} empty={m.list_resources_placeholders_empty()} {...props} />
    </>
  );
}

type EngagementSectionProps = ResourceListContentProps & {
  id: string;
  title: string;
  rows: Resource[];
  empty: string;
  separated?: boolean;
};

function EngagementSection({ id, title, rows, empty, separated = false, ...props }: EngagementSectionProps) {
  return (
    <section aria-labelledby={id}>
      {separated && <Separator className="mt-8" />}
      <h2 id={id} className="mb-4 mt-8 text-lg font-semibold">
        {title}
      </h2>
      <ResourceRows rows={rows} empty={empty} {...props} />
    </section>
  );
}

type ResourceRowsProps = ResourceListContentProps & {
  rows: Resource[];
  empty: string;
  enrich?: { description: string; action: { label: string; onClick: () => void } };
};

function ResourceRows({ rows, empty, enrich, ...props }: ResourceRowsProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        {...(enrich
          ? {
              icon: Users,
              description: enrich.description,
              action: { ...enrich.action, icon: Plus, requiresEdit: true },
            }
          : {})}
      >
        {empty}
      </EmptyState>
    );
  }
  return (
    <ItemGroup className="rounded-md border bg-card">
      {rows.map((resource, index) => (
        <Fragment key={resource.id}>
          {index > 0 && <ItemSeparator />}
          <ResourceRow resource={resource} {...props} />
        </Fragment>
      ))}
    </ItemGroup>
  );
}

function ResourceRow({
  resource,
  model,
  onEdit,
  onRequestArchive,
}: Pick<ResourceListContentProps, "model" | "onEdit" | "onRequestArchive"> & { resource: Resource }) {
  const metadata = model.buildMetadata(resource);
  const displayName = resolveResourceDisplayName(resource);
  return (
    <Item size="sm" role="listitem" data-testid="resource-row" className="rounded-none">
      <ItemContent className="flex-row flex-wrap items-center gap-2">
        <ColorSwatch color={model.resolveSwatchColor(resource)} />
        <span className="font-medium">{displayName}</span>
        {resource.kind === "placeholder" && <Badge variant="outline">{m.list_resources_placeholder_badge()}</Badge>}
        {metadata && <span className="text-sm text-muted-foreground">{` · ${metadata}`}</span>}
      </ItemContent>
      <ItemActions>
        {resource.kind === "person" && <FavouriteButton resource={resource} />}
        <EditButton label={m.list_edit_aria({ name: displayName })} onClick={() => onEdit(resource)} />
        <DeleteButton
          label={m.list_resources_archive_aria({ name: displayName })}
          onClick={() => onRequestArchive(resource)}
        />
      </ItemActions>
    </Item>
  );
}
