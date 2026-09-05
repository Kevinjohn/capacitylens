import { Star } from "lucide-react";
import type { Resource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { useStore } from "../../store/useStore";
import { useCanEdit } from "../../auth/permissionContext";
import { resourceDisplayName } from "../../lib/metadata";
import { errorMessage } from "../../lib/errorMessage";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export function FavouriteButton({ resource }: { resource: Resource }) {
  const canEdit = useCanEdit();
  const updateResource = useStore((state) => state.updateResource);
  const setNotice = useStore((state) => state.setNotice);

  if (!canEdit) return null;

  const selected = resource.isFavourite === true;
  const name = resourceDisplayName(resource);
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
        try {
          updateResource(resource.id, { isFavourite: !selected });
        } catch (error) {
          setNotice(errorMessage(error), "error");
        }
      }}
    >
      <Star aria-hidden className={cn("text-muted-foreground", selected && "fill-warn text-warn")} />
    </Button>
  );
}
