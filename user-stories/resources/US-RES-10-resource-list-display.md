# US-RES-10 — The resource list display

As an Editor, I want a scannable resource roster so that I can find people and priority resources quickly.

**Status:** Current
**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher
**Entry:** Resources screen → resource lists
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceListContent.tsx](../../apps/frontend/src/components/resources/ResourceListContent.tsx) · [useResourceListModel.ts](../../apps/frontend/src/components/resources/useResourceListModel.ts)

## Acceptance criteria

- The Resources screen lists people first; **Placeholders** appears only when Show placeholders is on and **External** only when Show external resources is on. People split into **Studio** and **Supplementary** when an active Supplementary person exists.
- For Editors, Admins and Owners, people and external-party rows show a favourite toggle; placeholders do not. Favourites sort first within People (or Studio and Supplementary) and within External.
- With no people, the list shows **No resources yet.**; when no resources of any kind are visible it adds **Add your first resource** for Editors and above.

## User flow

```mermaid
flowchart TD
  A["Resources screen"] --> B["Browse People, Placeholders and External"]
  B --> C["Supplementary people present?"]
  C -->|yes| D["People split into Studio and Supplementary"]
  C -->|no| E["People appear in one list"]
  B --> F["Favourite people appear first"]
  B --> G["No resources"] --> H["No resources yet"]
```

## Code flow

```mermaid
flowchart TD
  A["ResourceList calls useResourceListModel"] --> B["partitionResources separates people, placeholders and externals"]
  B --> C["engagement grouping and favourite comparators order rows"]
  C --> D["ResourceListContent renders grouped sections and empty state"]
  D --> E["FavouriteButton shown only for editable people and external rows"]
```

**Code references:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [useResourceListModel.ts](../../apps/frontend/src/components/resources/useResourceListModel.ts) · [ResourceListContent.tsx](../../apps/frontend/src/components/resources/ResourceListContent.tsx) · [FavouriteButton.tsx](../../apps/frontend/src/components/resources/FavouriteButton.tsx)
