import { Fragment } from "react";
import { Plus, Users } from "lucide-react";
import type { Resource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { AddButton, ColorSwatch, DeleteButton, EditButton, EmptyState, SectionHelp } from "../common/ui";
import { Separator } from "../ui/separator";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { externalExplainer } from "../../lib/externalCopy";
import { NEUTRAL_COLOR } from "../../lib/palette";
import { FavouriteButton } from "./FavouriteButton";

export interface ExternalResourceSectionProps {
  externals: Resource[];
  onAdd: () => void;
  onEdit: (resource: Resource) => void;
  onRequestArchive: (resource: Resource) => void;
}

export function ExternalResourceSection({ externals, onAdd, onEdit, onRequestArchive }: ExternalResourceSectionProps) {
  return (
    <section aria-labelledby="external-heading">
      {/* Decorative rule before the External section (Phase 8) — see the People→Placeholders
          Separator above. */}
      <Separator className="mt-8" />
      <div className="mb-4 mt-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <h2 id="external-heading" className="text-lg font-semibold">
            {m.list_resources_external_heading()}
          </h2>
          <SectionHelp title={m.list_resources_external_heading()}>{externalExplainer()}</SectionHelp>
        </div>
        <AddButton label={m.list_resources_add_external()} onClick={onAdd} />
      </div>
      {externals.length === 0 ? (
        <EmptyState
          icon={Users}
          description={m.list_resources_external_empty_desc()}
          action={{
            label: m.list_resources_external_empty_action(),
            onClick: onAdd,
            icon: Plus,
            requiresEdit: true,
          }}
        >
          {m.list_resources_external_empty()}
        </EmptyState>
      ) : (
        <ItemGroup className="rounded-md border bg-card">
          {externals.map((r, index) => (
            <Fragment key={r.id}>
              {index > 0 && <ItemSeparator />}
              <Item size="sm" role="listitem" data-testid="external-row" className="rounded-none">
                <ItemContent className="flex-row flex-wrap items-center gap-2">
                  <ColorSwatch color={NEUTRAL_COLOR} />
                  <span className="font-medium">{r.name ?? r.role}</span>
                  {r.name && r.role && <span className="text-sm text-muted-foreground">· {r.role}</span>}
                </ItemContent>
                <ItemActions>
                  <FavouriteButton resource={r} />
                  <EditButton label={m.list_edit_aria({ name: r.name ?? r.role })} onClick={() => onEdit(r)} />
                  <DeleteButton
                    label={m.list_resources_archive_aria({ name: r.name ?? r.role })}
                    onClick={() => onRequestArchive(r)}
                  />
                </ItemActions>
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      )}
    </section>
  );
}
