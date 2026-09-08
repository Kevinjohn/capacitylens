import { useMemo, useState, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore";
import {
  hasDisciplinesEnabled,
  hasExternalResourcesEnabled,
  hasPlaceholdersEnabled,
  hasVisibleInternalProjects,
} from "../store/selectors";
import { useActiveScopedData } from "../store/useScopedData";
import { m } from "@/i18n";
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from "./ui/command";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { buildPaletteItems, type PaletteItem } from "./buildPaletteItems";

function groupPaletteItems(items: PaletteItem[]) {
  const sections: { title: string; items: PaletteItem[] }[] = [];
  for (const item of items) {
    let section = sections.find((candidate) => candidate.title === item.section);
    if (!section) {
      section = { title: item.section, items: [] };
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}

function useActiveDescendant(input: HTMLInputElement | null, list: HTMLDivElement | null) {
  useLayoutEffect(() => {
    if (!input || !list) return;
    const sync = () => {
      const activeId = list.querySelector<HTMLElement>('[cmdk-item=""][aria-selected="true"]')?.id;
      if (activeId) input.setAttribute("aria-activedescendant", activeId);
      else input.removeAttribute("aria-activedescendant");
    };
    const observer = new MutationObserver(sync);
    observer.observe(list, { attributes: true, attributeFilter: ["aria-selected"], childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, [input, list]);
}

function usePaletteItems(query: string, onClose: () => void) {
  const navigate = useNavigate();
  const goToToday = useStore((state) => state.goToToday);
  const goToDate = useStore((state) => state.goToDate);
  const jumpToResource = useStore((state) => state.jumpToResource);
  const setFilters = useStore((state) => state.setFilters);
  const data = useActiveScopedData();
  const disciplinesEnabled = useStore((state) => hasDisciplinesEnabled(state.data, state.activeAccountId));
  const placeholdersEnabled = useStore((state) => hasPlaceholdersEnabled(state.data, state.activeAccountId));
  const externalEnabled = useStore((state) => hasExternalResourcesEnabled(state.data, state.activeAccountId));
  const showInternalProjects = useStore((state) => hasVisibleInternalProjects(state.data, state.activeAccountId));
  return useMemo(
    () =>
      buildPaletteItems({
        query,
        data,
        disciplinesEnabled,
        placeholdersEnabled,
        externalEnabled,
        showInternalProjects,
        navigate,
        goToToday,
        goToDate,
        jumpToResource,
        setFilters,
        onClose,
      }),
    [
      query,
      data,
      disciplinesEnabled,
      placeholdersEnabled,
      externalEnabled,
      showInternalProjects,
      navigate,
      goToToday,
      goToDate,
      jumpToResource,
      setFilters,
      onClose,
    ],
  );
}

function PaletteResults({
  items,
  sections,
  activeValue,
  setListElement,
  query,
}: {
  items: PaletteItem[];
  sections: { title: string; items: PaletteItem[] }[];
  activeValue: string;
  setListElement: (element: HTMLDivElement | null) => void;
  query: string;
}) {
  return (
    <CommandList ref={setListElement} label={m.palette_results_label()}>
      {items.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-faint">{m.palette_no_results({ query })}</div>
      )}
      {sections.map((section) => (
        <CommandGroup key={section.title} heading={section.title}>
          {section.items.map((item) => (
            <CommandItem
              key={item.id}
              value={item.id}
              onSelect={() => item.onSelect()}
              data-testid="command-palette-option"
            >
              <span className="flex-1 truncate">{item.label}</span>
              {item.sublabel && (
                <span
                  className={cn(
                    "shrink-0 truncate text-xs",
                    item.id === activeValue ? "text-muted-foreground" : "text-faint",
                  )}
                >
                  {item.sublabel}
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </CommandList>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ onClose }: { onClose: () => void }) {
  // Scoped `data` has accounts blanked, so read the discipline flag from the full store.
  // Per-account view pref (default OFF): when off, placeholders are not offered as jump targets.
  // Per-account view pref (default OFF): when off, external / 3rd parties are not offered as
  // jump targets — their schedule row is hidden, so jumping to it would scroll to nothing.
  // Internal-project results also jump to the schedule, so omit them when their bars are hidden.
  // Internal ACTIVITIES deliberately remain below: they open the complete management list instead.

  const [query, setQuery] = useState("");
  // cmdk owns highlight/selection by item `value` (we pass each item's id). Controlling it lets us
  // know which row is active so we can drive the input's `aria-activedescendant` (see below); cmdk
  // routes its own pointer/keyboard moves through onValueChange back into this state.
  const [activeValue, setActiveValue] = useState("");

  // Portal-backed cmdk nodes arrive after this component's first commit. Callback-ref state makes
  // their availability an explicit effect dependency for the active-descendant repair below.
  const [inputElement, setInputElement] = useState<HTMLInputElement | null>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  // Build the full item list (kept verbatim — capacitylens's own fuzzyFilter drives results, not cmdk's
  // internal filter, hence `shouldFilter={false}` below). Memoized so the fuzzy filter over ALL data
  // does NOT re-run on every render: cmdk churns the controlled `value` on each pointer-move (→
  // re-render), and the active-row change must not re-run the filter. Keyed on the real inputs only.
  const items: PaletteItem[] = usePaletteItems(query, onClose);

  // Group items by section for rendering (one CommandGroup per section).

  // Repair the combobox's `aria-activedescendant`. cmdk hardcodes it from its OWN `selectedItemId`,
  // which it fails to populate on the controlled-`value` path (the value-change handler short-circuits
  // once a controlled value is present) — so the input names no active descendant, breaking the
  // combobox SR pattern. cmdk's element ids are its internal `useId`s (we can't pass our own — its
  // `id` wins over props), so we read the active option's real id straight off the DOM and write it
  // onto the input ourselves. cmdk marks exactly ONE option `aria-selected="true"` (the active row),
  // so we match that single option by its selected state — no need to also cross-check `data-value`
  // against our controlled `activeValue` (redundant, and it breaks the auto-selected first row whose
  // value our state hasn't caught up to yet). cmdk may establish its initial selection after our
  // parent layout effect, and later changes its internal row without necessarily rendering this
  // component. Observe only list selection/child mutations so the repair follows both paths. React
  // won't clobber it because cmdk keeps emitting the same `null` (null → null is a no-op diff).
  // Repair only the focused input: it is the element whose active descendant assistive technology
  // reads. Do not mirror this relationship onto the non-focusable listbox.
  useActiveDescendant(inputElement, listElement);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="command-palette"
        overlayProps={{
          "data-testid": "command-palette-overlay",
          onMouseDown: (event) => {
            event.preventDefault();
            onClose();
          },
        }}
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[15svh] max-h-[60dvh] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">{m.palette_dialog_label()}</DialogTitle>
        <Command shouldFilter={false} loop={false} value={activeValue} onValueChange={setActiveValue}>
          {/* Search input row */}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            {/* Magnifying glass icon */}
            <svg className="size-4 shrink-0 text-faint" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <CommandInput
              ref={setInputElement}
              autoFocus
              aria-label={m.palette_search_aria()}
              placeholder={m.palette_search_placeholder()}
              value={query}
              onValueChange={setQuery}
              data-testid="command-palette-input"
            />
            <kbd className="hidden rounded border px-1.5 py-0.5 text-xs text-faint sm:block">{m.palette_esc()}</kbd>
          </div>

          {/* Results — cmdk uses its `label` prop (not aria-label) for the listbox's accessible name. */}
          <PaletteResults
            items={items}
            sections={groupPaletteItems(items)}
            activeValue={activeValue}
            setListElement={setListElement}
            query={query}
          />
        </Command>
      </DialogContent>
    </Dialog>
  );
}
