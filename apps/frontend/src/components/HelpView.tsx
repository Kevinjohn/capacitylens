import { Link, useOutletContext } from 'react-router-dom';
import { useTourAction } from '@/hooks/useTourAction';
import { m } from '@/i18n';
import { useStore } from '@/store/useStore';
import { Button } from './ui/button';
import { ListPage } from './common/ListPage';
import { useDiagnosticsAccessDecision } from './diagnostics/useDiagnosticsAccessDecision';
import { APP_NAME } from '@capacitylens/shared/brand';
import { ROUTE_DIAGNOSTICS } from '@/lib/tourAnchors';

/** Context the app shell passes to routed pages through its `Outlet`. */
export type AppOutletContext = { showOrientation: (trigger: HTMLButtonElement) => void };

/** Shared guidance and a role-aware route to the existing schedule tour. */
export function HelpView() {
  const setNotice = useStore((state) => state.setNotice);
  const shell = useOutletContext<AppOutletContext | null>();
  const diagnosticsAllowed = useDiagnosticsAccessDecision() === 'allowed';
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
          {m.help_show_tour()}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="product-orientation-reopen"
          onClick={(event) => shell?.showOrientation(event.currentTarget)}
        >
          {m.product_orientation_heading({ app: APP_NAME })}
        </Button>
        <p className="text-sm">
          <a
            className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline"
            href="https://kevinjohn.github.io/capacitylens/using/"
          >
            {m.help_user_guides()}
          </a>
        </p>
        {diagnosticsAllowed && (
          <p className="text-sm">
            <Link
              className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline"
              to={ROUTE_DIAGNOSTICS}
            >
              {m.nav_diagnostics()}
            </Link>
            <span className="block text-muted-foreground">{m.help_diagnostics_description()}</span>
          </p>
        )}
      </div>
    </ListPage>
  );
}
