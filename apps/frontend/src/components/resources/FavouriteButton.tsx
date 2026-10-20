import { useRef, useState } from "react";
import { capturePlanningDraft, planningActions } from "@/data/planning/planningActions";
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
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const setNotice = useStore((state) => state.setNotice);

  if (!canEdit) return null;

  const selected = resource.isFavourite === true;
  const name = resolveResourceDisplayName(resource);
  const label = selected ? m.list_resources_unfavourite_aria({ name }) : m.list_resources_favourite_aria({ name });

  const toggle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const draft = capturePlanningDraft(resource);
    try {
      await planningActions.updateResource(resource.id, { isFavourite: !selected }, draft);
    } catch (error) {
      setNotice(resolveErrorMessage(error), "error");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={selected}
      disabled={saving}
      onClick={() => void toggle()}
    >
      <Star aria-hidden className={cn("text-muted-foreground", selected && "fill-warn text-warn")} />
    </Button>
  );
}
