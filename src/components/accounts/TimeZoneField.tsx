import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { RequiredFieldLabel } from "../common/fields/fieldLayout";
import type { Option } from "../common/ui";
import { m } from "@/i18n";
import { cn } from "@/lib/utils";

interface TimeZoneFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
}

function TimeZoneMenu({
  listId,
  label,
  value,
  options,
  onSelect,
}: Pick<TimeZoneFieldProps, "label" | "value" | "options"> & {
  listId: string;
  onSelect: (value: string) => void;
}) {
  return (
    <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
      <Command label={m.picker_timezone_search()}>
        <div className="flex items-center border-b px-3">
          <CommandInput autoFocus placeholder={m.picker_timezone_search()} aria-label={m.picker_timezone_search()} />
        </div>
        <CommandList id={listId} aria-label={label}>
          <CommandEmpty>{m.picker_timezone_no_results()}</CommandEmpty>
          {options.map((option) => (
            <CommandItem
              key={option.value}
              value={`${option.value} ${option.label}`}
              data-value={option.value}
              onSelect={() => onSelect(option.value)}
              className={cn(option.value === value && "font-medium")}
            >
              {option.label}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </PopoverContent>
  );
}

export function TimeZoneField({ label, value, onChange, options }: TimeZoneFieldProps) {
  const id = useId();
  const listId = `${id}-options`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) triggerRef.current?.focus();
  };

  return (
    <Field>
      <RequiredFieldLabel htmlFor={id} label={label} />
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-haspopup="listbox"
            className="w-full justify-between gap-2 font-normal"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            <span className="truncate text-left">{selected?.label ?? value}</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <TimeZoneMenu
          listId={listId}
          label={label}
          value={value}
          options={options}
          onSelect={(nextValue) => {
            onChange(nextValue);
            handleOpenChange(false);
          }}
        />
      </Popover>
    </Field>
  );
}
