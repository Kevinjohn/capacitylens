import { useId, useMemo, useState, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/store/useStore";
import {
  hasDisciplinesEnabled,
  hasExternalResourcesEnabled,
  hasPlaceholdersEnabled,
  resolveCapacityOverviewAccess,
} from "@/store/selectors";
import { usePermissionStatus, useRole } from "@/auth/permissionContext";
import { resolveCapacityOverviewAccessDecision } from "@/auth/capacityOverviewAccess";
import { useActiveScopedData } from "@/store/useScopedData";
import { m } from "@/i18n";
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from "./ui/command";
import { cn } from "@/lib/cn";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { buildPaletteItems } from "./buildPaletteItems";
import type { PaletteItem } from "./buildPaletteItems";
import { useDiagnosticsAccessDecision } from "./diagnostics/useDiagnosticsAccessDecision";
import { FieldError } from "@/components/ui/field";
import { MAX_LOCAL_QUERY_CODE_UNITS, rejectOverlongQueryPaste } from "@/lib/localQueryInput";

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
  const role = useRole();
  const permissionStatus = usePermissionStatus();
  const overviewAccess = useStore((state) => resolveCapacityOverviewAccess(state.data, state.activeAccountId));
  const showCapacityOverview =
    resolveCapacityOverviewAccessDecision({ role, status: permissionStatus, access: overviewAccess }) === "allowed";
  const showDiagnostics = useDiagnosticsAccessDecision() === "allowed";
  return useMemo(
    () =>
      buildPaletteItems({
        query,
        data,
        disciplinesEnabled,
        showCapacityOverview,
        showDiagnostics,
        placeholdersEnabled,
        externalEnabled,
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
      showCapacityOverview,
      showDiagnostics,
      placeholdersEnabled,
      externalEnabled,
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

/** Renders the command palette and manages its active result and search state. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  // Scoped `data` has accounts blanked, so read the discipline flag from the full store.
  // Per-account view pref (default off): when off, placeholders are not offered as jump targets.
  // Per-account view pref (default off): when off, external / 3rd parties are not offered as
  // jump targets, their schedule row is hidden, so jumping to it would scroll to nothing.
  // Internal-project results also jump to the schedule, so omit them when their bars are hidden.
  // Internal activities deliberately remain below: they open the complete management list instead.

  const [query, setQuery] = useState("");
  const [queryTooLong, setQueryTooLong] = useState(false);
  const queryErrorId = useId();
  // cmdk owns highlight/selection by item `value` (we pass each item's id). Controlling it lets us
  // know which row is active so we can drive the input's `aria-activedescendant` (see below); cmdk
  // routes its own pointer/keyboard moves through onValueChange back into this state.
  const [activeValue, setActiveValue] = useState("");

  // Portal-backed cmdk nodes arrive after this component's first commit. Callback-ref state makes
  // their availability an explicit effect dependency for the active-descendant repair below.
  const [inputElement, setInputElement] = useState<HTMLInputElement | null>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  // Palette filtering depends on data and the query, not the changing active-result value, so pointer navigation must not rebuild search results.
  const items: PaletteItem[] = usePaletteItems(query, onClose);

  // Controlled cmdk selection does not reliably publish aria-activedescendant. Mirror the selected option's actual DOM id onto the focused input, observing list selection changes because cmdk can update without rendering this component.
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
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <svg className="size-4 shrink-0 text-faint" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div className="flex min-w-0 flex-1 flex-col">
              <CommandInput
                maxLength={MAX_LOCAL_QUERY_CODE_UNITS}
                ref={setInputElement}
                autoFocus
                aria-label={m.palette_search_aria()}
                placeholder={m.palette_search_placeholder()}
                value={query}
                onValueChange={(value) => {
                  setQuery(value);
                  if (value.length <= MAX_LOCAL_QUERY_CODE_UNITS) setQueryTooLong(false);
                }}
                onPaste={(event) => {
                  setQueryTooLong(rejectOverlongQueryPaste(event));
                }}
                aria-invalid={queryTooLong || undefined}
                aria-describedby={queryTooLong ? queryErrorId : undefined}
                data-testid="command-palette-input"
              />
              {queryTooLong && <FieldError id={queryErrorId}>{m.validation_text_too_long()}</FieldError>}
            </div>
            <kbd className="hidden rounded border px-1.5 py-0.5 text-xs text-faint sm:block">{m.palette_esc()}</kbd>
          </div>

          {/* Results: cmdk uses its `label` prop (not aria-label) for the listbox's accessible name. */}
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
