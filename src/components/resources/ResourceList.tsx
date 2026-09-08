import { Fragment, useMemo, useState } from "react";
import { Plus, Users } from "lucide-react";
import { useStore } from "../../store/useStore";
import {
  hasDisciplinesEnabled,
  hasExternalResourcesEnabled,
  hasResourceEngagementGrouping,
  hasPlaceholdersEnabled,
} from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useEntityListState } from "../../hooks/useEntityListState";
import { AddButton, ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from "../common/ui";
import { Separator } from "../ui/separator";
import { resolveResourceDisplayName } from "../../lib/metadata";
import { ResourceForm } from "./ResourceForm";
import { ExternalForm } from "../external/ExternalForm";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { Resource, ResourceKind } from "@capacitylens/shared/types/entities";
import { useLifecycleActions } from "../../hooks/useLifecycleActions";
import { m } from "@/i18n";
import { Badge } from "../ui/badge";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import {
  createDisplayNameComparator,
  createEngagementFavouriteDisplayNameComparator,
  createFavouriteDisplayNameComparator,
} from "../../lib/displayOrder";
import { FavouriteButton } from "./FavouriteButton";
import { ExternalResourceSection } from "./ExternalResourceSection";

interface RenderEngagementSectionInput {
  id: string;
  title: string;
  rows: Resource[];
  empty: string;
  separated?: boolean | undefined;
}

const byFavouriteResourceDisplayName = createFavouriteDisplayNameComparator<Resource>(resolveResourceDisplayName);
const byEngagementFavouriteResourceDisplayName =
  createEngagementFavouriteDisplayNameComparator<Resource>(resolveResourceDisplayName);
const byResourceDisplayName = createDisplayNameComparator<Resource>(resolveResourceDisplayName);

export function ResourceList() {
  const data = useActiveScopedData();
  const resources = data.resources;
  const disciplines = data.disciplines;
  const disciplinesById = useMemo(
    () => new Map(disciplines.map((discipline) => [discipline.id, discipline])),
    [disciplines],
  );
  const disciplinesEnabled = useStore((state) => hasDisciplinesEnabled(state.data, state.activeAccountId));
  const groupResourcesByEngagement = useStore((state) =>
    hasResourceEngagementGrouping(state.data, state.activeAccountId),
  );
  // Per-account view pref (default OFF). When off the placeholder feature is hidden, so the
  // Placeholders section and its "Add placeholder" affordance don't render. Existing placeholder
  // resources stay in the data untouched — they simply aren't shown until the pref is turned on.
  const placeholdersEnabled = useStore((state) => hasPlaceholdersEnabled(state.data, state.activeAccountId));
  // Per-account view pref (default OFF), EXACT analog of placeholdersEnabled. When off the External
  // section (rows + "Add external party" affordance) doesn't render; existing externals stay in the
  // data untouched and reappear when re-enabled (Settings → External).
  const externalEnabled = useStore((state) => hasExternalResourcesEnabled(state.data, state.activeAccountId));
  // The per-row action now ARCHIVES (soft-delete is reached LATER from Settings → Archived & deleted
  // on an archived row). `archive` branches server/local in useLifecycleActions — and crucially, in
  // SERVER mode it reloads the active slice so the archived row vanishes from this list + the schedule.
  const { archive } = useLifecycleActions();
  const { editing, setEditing, confirming, setConfirming } = useEntityListState<Resource>();
  // External rows get their OWN create/edit/confirm state + the trimmed ExternalForm (no capacity
  // fields), kept separate from the person/placeholder triple above so the two modals never collide.
  const externalState = useEntityListState<Resource>();
  // People and placeholders each have their own add button; remember which kind is
  // being created so the right modal opens.
  const [creatingKind, setCreatingKind] = useState<ResourceKind | null>(null);

  // Resources, placeholders, and externals all live on THIS tab now. Externals (the External section
  // below) are gated behind the per-account `externalEnabled` pref; people/placeholders split by kind.
  // Single pass over `resources` (kind is a 3-way enum — person/placeholder/external — so one bucketing
  // loop is exactly equivalent to the three independent .filter() calls it replaces), memoized so a
  // render that doesn't touch resource data (e.g. a FavouriteButton hover) doesn't re-partition/re-sort.
  const { people, studioPeople, supplementaryPeople, placeholders, externals } = useMemo(() => {
    const people: Resource[] = [];
    const placeholders: Resource[] = [];
    const externals: Resource[] = [];
    for (const resource of resources) {
      if (resource.kind === "person") people.push(resource);
      else if (resource.kind === "placeholder") placeholders.push(resource);
      else if (isExternalResource(resource)) externals.push(resource);
    }
    people.sort(groupResourcesByEngagement ? byEngagementFavouriteResourceDisplayName : byFavouriteResourceDisplayName);
    placeholders.sort(byResourceDisplayName);
    externals.sort(byFavouriteResourceDisplayName);
    return {
      people,
      studioPeople: people.filter((resource) => resource.engagement === "studio"),
      supplementaryPeople: people.filter((resource) => resource.engagement === "supplementary"),
      placeholders,
      externals,
    };
  }, [resources, groupResourcesByEngagement]);
  const visibleResourceCount =
    people.length + (placeholdersEnabled ? placeholders.length : 0) + (externalEnabled ? externals.length : 0);

  // A missing or dangling discipline is unassigned. This metadata is appended to the role, so an
  // empty-value glyph would become a misleading trailing "· —" rather than useful information.
  const resolveDisciplineName = (id?: string) => (id ? disciplinesById.get(id)?.name : undefined);
  // A resource's colour follows its discipline (resources no longer pick their own);
  // fall back to the stored colour for the disciplineless ones — and for everyone when
  // the account doesn't use disciplines.
  const resolveSwatchColor = (resource: Resource) =>
    (disciplinesEnabled && resource.disciplineId ? disciplinesById.get(resource.disciplineId)?.color : undefined) ??
    resource.color;

  const buildResourceMetadata = (resource: Resource) =>
    [resource.role, disciplinesEnabled ? resolveDisciplineName(resource.disciplineId) : undefined]
      .filter(Boolean)
      .join(" · ");

  const renderRow = (resource: Resource) => {
    const metadata = buildResourceMetadata(resource);
    return (
      <Item size="sm" role="listitem" data-testid="resource-row" className="rounded-none">
        <ItemContent className="flex-row flex-wrap items-center gap-2">
          <ColorSwatch color={resolveSwatchColor(resource)} />
          <span className="font-medium">{resolveResourceDisplayName(resource)}</span>
          {resource.kind === "placeholder" && <Badge variant="outline">{m.list_resources_placeholder_badge()}</Badge>}
          {metadata && <span className="text-sm text-muted-foreground">{` · ${metadata}`}</span>}
        </ItemContent>
        <ItemActions>
          {resource.kind === "person" && <FavouriteButton resource={resource} />}
          <EditButton
            label={m.list_edit_aria({ name: resolveResourceDisplayName(resource) })}
            onClick={() => setEditing(resource)}
          />
          <DeleteButton
            label={m.list_resources_archive_aria({ name: resolveResourceDisplayName(resource) })}
            onClick={() => setConfirming(resource)}
          />
        </ItemActions>
      </Item>
    );
  };

  // `enrich` carries the icon/description/CTA for the *genuinely-empty* People box. The
  // placeholder box passes none — its bare message is left as-is (its own "Add placeholder"
  // button sits right above it). The `empty` text stays the load-bearing children either way.
  const box = (
    rows: Resource[],
    empty: string,
    enrich?: { description: string; action: { label: string; onClick: () => void } },
  ) =>
    rows.length === 0 ? (
      <EmptyState
        {...(enrich ? { icon: Users, description: enrich.description } : {})}
        {...(enrich?.action ? { action: { ...enrich.action, icon: Plus, requiresEdit: true } } : {})}
      >
        {empty}
      </EmptyState>
    ) : (
      <ItemGroup className="rounded-md border bg-card">
        {rows.map((resource, index) => (
          <Fragment key={resource.id}>
            {index > 0 && <ItemSeparator />}
            {renderRow(resource)}
          </Fragment>
        ))}
      </ItemGroup>
    );

  const renderEngagementSection = ({ id, title, rows, empty, separated = false }: RenderEngagementSectionInput) => (
    <section aria-labelledby={id}>
      {separated && <Separator className="mt-8" />}
      <h2 id={id} className="mb-4 mt-8 text-lg font-semibold">
        {title}
      </h2>
      {box(rows, empty)}
    </section>
  );

  return (
    <ListPage
      title={m.list_resources_title()}
      addLabel={m.list_resources_add()}
      onAdd={() => setCreatingKind("person")}
    >
      {groupResourcesByEngagement && people.length > 0 ? (
        <>
          {renderEngagementSection({
            id: "studio-resources-heading",
            title: m.list_resources_studio_heading(),
            rows: studioPeople,
            empty: m.list_resources_studio_empty(),
          })}
          {renderEngagementSection({
            id: "supplementary-resources-heading",
            title: m.list_resources_supplementary_heading(),
            rows: supplementaryPeople,
            empty: m.list_resources_supplementary_empty(),
            separated: true,
          })}
        </>
      ) : (
        box(
          people,
          m.list_resources_empty(),
          visibleResourceCount === 0
            ? {
                description: m.list_resources_empty_desc(),
                action: { label: m.list_resources_empty_action(), onClick: () => setCreatingKind("person") },
              }
            : undefined,
        )
      )}

      {/* The whole placeholder feature is behind the per-account `placeholdersEnabled` pref
          (default off, Settings → Placeholders). When off, the management section + "Add
          placeholder" affordance are hidden; existing placeholder data is preserved untouched. */}
      {placeholdersEnabled && (
        <>
          {/* Decorative rule closing off the People section before Placeholders (Phase 8) — a
              shadcn Separator in place of the bare mt-8 gap. decorative (no a11y role) so it
              adds a visual divider without a spurious separator in the accessibility tree. */}
          <Separator className="mt-8" />
          <div className="mb-4 mt-8 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{m.list_resources_placeholders_heading()}</h2>
            <AddButton label={m.list_resources_add_placeholder()} onClick={() => setCreatingKind("placeholder")} />
          </div>
          {box(placeholders, m.list_resources_placeholders_empty())}
        </>
      )}

      {/* External / 3rd parties moved INTO this tab (from the old standalone /external page) behind the
          per-account `externalEnabled` pref (default off, Settings → External). When off, the whole
          section is hidden; existing external data is preserved untouched and returns when re-enabled. */}
      {externalEnabled && (
        <ExternalResourceSection
          externals={externals}
          onAdd={() => externalState.setCreating(true)}
          onEdit={(resource) => externalState.setEditing(resource)}
          onRequestArchive={(resource) => externalState.setConfirming(resource)}
        />
      )}

      {creatingKind && <ResourceForm kind={creatingKind} onClose={() => setCreatingKind(null)} />}
      {editing && <ResourceForm resource={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_resources_archive_title()}
          message={m.list_resources_archive_message({ name: resolveResourceDisplayName(confirming) })}
          confirmLabel={m.list_archive()}
          onConfirm={() => {
            void archive("resources", confirming.id);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}

      {/* External create/edit reuse the trimmed ExternalForm; the row action archives (soft-delete is
          reached later from Settings → Archived & deleted). */}
      {externalState.creating && <ExternalForm onClose={() => externalState.setCreating(false)} />}
      {externalState.editing && (
        <ExternalForm resource={externalState.editing} onClose={() => externalState.setEditing(null)} />
      )}
      {externalState.confirming && (
        <ConfirmDialog
          title={m.list_resources_archive_title()}
          message={m.list_resources_archive_message({
            name: externalState.confirming.name ?? externalState.confirming.role,
          })}
          confirmLabel={m.list_archive()}
          onConfirm={() => {
            void archive("resources", externalState.confirming!.id);
            externalState.setConfirming(null);
          }}
          onCancel={() => externalState.setConfirming(null)}
        />
      )}
    </ListPage>
  );
}
