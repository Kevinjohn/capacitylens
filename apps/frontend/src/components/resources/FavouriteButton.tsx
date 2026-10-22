import { Star } from "lucide-react";
import type { Resource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { useStore } from "@/store/useStore";
import { useCanEdit } from "@/auth/permissionContext";
import { resolveResourceDisplayName } from "@/lib/metadata";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/** Toggles a resource favourite when the current role permits editing. */
export function FavouriteButton({ resource }: { resource: Resource }) {
  const canEdit = useCanEdit();
  const updateResource = useStore((state) => state.updateResource);
  const setNotice = useStore((state) => state.setNotice);

  if (!canEdit) return null;

  const selected = resource.isFavourite === true;
  const name = resolveResourceDisplayName(resource);
  const label = selected ? m.list_resources_unfavourite_aria({ name }) : m.list_resources_favourite_aria({ name });

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={selected}
      onClick={() => {
        void updateResource(resource.id, { isFavourite: !selected }).catch((error: unknown) => {
          // Report a rejected favourite change instead of silently leaving the preference unchanged.
          setNotice(resolveErrorMessage(error), "error");
        });
      }}
    >
      <Star aria-hidden className={cn("text-muted-foreground", selected && "fill-warn text-warn")} />
    </Button>
  );
}
