import { Link } from "react-router-dom";
import { useTourAction } from "@/hooks/useTourAction";
import { m } from "@/i18n";
import { useStore } from "@/store/useStore";
import { Button } from "./ui/button";
import { ListPage } from "./common/ListPage";

/** Shared guidance and a role-aware route to the existing schedule tour. */
export function HelpView() {
  const setNotice = useStore((state) => state.setNotice);
  const { canShowTour, tourBusy, showTour } = useTourAction(setNotice);

  return (
    <ListPage title={m.help_title()}>
      <div className="flex flex-col items-start gap-4">
        <p className="text-sm text-muted-foreground">{m.help_description()}</p>
        <Button
          size="sm"
          data-testid="show-tour"
          disabled={!canShowTour || tourBusy}
          aria-busy={tourBusy || undefined}
          onClick={() => void showTour()}
        >
          {m.gs_show_me_around()}
        </Button>
        <p className="text-sm">
          <Link className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline" to="/using/">
            {m.help_user_guides()}
          </Link>
        </p>
      </div>
    </ListPage>
  );
}
