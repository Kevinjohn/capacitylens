import { Suspense } from 'react';
import type { CSSProperties } from 'react';
import { matchPath, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { GettingStarted } from './GettingStarted';
import { Toaster } from 'sonner';
import { useStore } from '@/store/useStore';
import { CommandPalette } from './CommandPalette';
import { PermissionProvider } from '@/auth/PermissionProvider';
import { RotateHint } from './RotateHint';
import { Spinner } from './ui/spinner';
import { Alert, AlertDescription } from './ui/alert';
import { m } from '@/i18n';
import { ACCOUNT_LINK } from '@/lib/navLinks';
import { AppEntryGate } from './AppEntryGate';
import { useAppShellController } from './useAppShellController';
import { useVisibleRoutes } from './useVisibleRoutes';
import { AppSidebar } from './AppSidebar';
import { SidebarProvider, SidebarTrigger, useSidebar } from './ui/sidebar';
import { readPlanningProblem } from '@/data/planning/planningNotices';
import { useAuth } from '@/auth/authContext';
import { ProductOrientation } from './ProductOrientation';
import { MasqueradeBanner } from './MasqueradeBanner';
import { buildMasqueradeBannerContent } from './masqueradeBannerContent';
import { useProductOrientation } from './useProductOrientation';
import type { AppOutletContext } from './HelpView';

function MobileSidebarTrigger() {
  const { openMobile } = useSidebar();
  return (
    <SidebarTrigger
      aria-expanded={openMobile}
      aria-label={openMobile ? m.nav_collapse_menu() : m.nav_expand_menu()}
    />
  );
}

function AppShellLoader() {
  return (
    <div
      className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <Spinner role="presentation" aria-label={undefined} />
      {m.app_loading()}
    </div>
  );
}

function AppShellToaster({ theme }: { theme: ReturnType<typeof useStore.getState>['theme'] }) {
  return (
    <Toaster
      theme={theme === 'system' ? 'system' : theme}
      position="bottom-center"
      closeButton
      toastOptions={{ classNames: { error: 'toast-error' } }}
      style={
        {
          '--normal-bg': 'var(--color-elevated)',
          '--normal-text': 'var(--color-ink)',
          '--normal-border': 'var(--color-line)',
        } as CSSProperties
      }
    />
  );
}

type GatedAppProps = {
  hydrated: boolean;
  hasActiveAccount: boolean;
  ambiguousAccountDirectory: boolean;
  allowWithoutActiveAccount: boolean;
  activeAccountId: ReturnType<typeof useStore.getState>['activeAccountId'];
  activeAccountLoadFailed: ReturnType<typeof useStore.getState>['activeAccountLoadFailed'];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activeAccount:
    | ReturnType<typeof useStore.getState>['data']['accounts'][number]
    | ReturnType<typeof useStore.getState>['accountSummaries'][number]
    | undefined;
  dirtyForm: boolean;
  paletteOpen: boolean;
  closePalette: () => void;
  masqueradeBanner: ReturnType<typeof buildMasqueradeBannerContent>;
  navigate: ReturnType<typeof useNavigate>;
};

function GatedApp({
  hydrated,
  hasActiveAccount,
  ambiguousAccountDirectory,
  allowWithoutActiveAccount,
  activeAccountId,
  activeAccountLoadFailed,
  sidebarOpen,
  setSidebarOpen,
  activeAccount,
  dirtyForm,
  paletteOpen,
  closePalette,
  masqueradeBanner,
  navigate,
}: GatedAppProps) {
  const { user } = useAuth();
  const orientation = useProductOrientation({
    userId: user?.id ?? null,
    accountId: activeAccountId,
  });

  return (
    <AppEntryGate
      hydrated={hydrated}
      hasActiveAccount={hasActiveAccount}
      ambiguousAccountDirectory={ambiguousAccountDirectory}
      allowWithoutActiveAccount={allowWithoutActiveAccount}
      activeAccountId={activeAccountId}
      activeAccountLoadFailed={activeAccountLoadFailed}
      activeAccountName={activeAccount?.name ?? m.account_load_fallback_name()}
      onRetryActiveAccountLoad={() =>
        activeAccountId ? useStore.getState().refreshPlanning() : Promise.resolve(false)
      }
    >
      <PermissionProvider>
        <SidebarProvider
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          className="h-full min-h-0"
          style={{ '--sidebar-width': '12rem', '--sidebar-width-icon': '3.5rem' } as CSSProperties}
        >
          <GatedSidebar sidebarOpen={sidebarOpen} />
          {/* prettier-ignore */}
          <GatedMain
            hydrated={hydrated}
            masqueradeBanner={masqueradeBanner}
            navigate={navigate}
            orientation={orientation}
          />
          {paletteOpen && !dirtyForm && <CommandPalette onClose={closePalette} />}
          <RotateHint />
        </SidebarProvider>
      </PermissionProvider>
    </AppEntryGate>
  );
}

function GatedSidebar({ sidebarOpen }: Pick<GatedAppProps, 'sidebarOpen'>) {
  const routes = useVisibleRoutes();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-(--z-index-skip-link) focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-ink focus:shadow focus:ring-2 focus:ring-brand"
      >
        {m.nav_skip_to_content()}
      </a>
      <AppSidebar
        adminLinks={routes.filter(({ sidebar }) => sidebar === 'admin')}
        navLinks={routes.filter(({ sidebar }) => sidebar === 'primary')}
        open={sidebarOpen}
      />
    </>
  );
}

function GatedMain({
  hydrated,
  masqueradeBanner,
  navigate,
  orientation,
}: Pick<GatedAppProps, 'hydrated' | 'masqueradeBanner' | 'navigate'> & {
  orientation: ReturnType<typeof useProductOrientation>;
}) {
  const loader = <AppShellLoader />;
  const projectionChanging = useStore(
    (state) => state.masquerade.kind === 'starting' || state.masquerade.kind === 'ending',
  );
  const planningProblem = useStore((state) => readPlanningProblem(state.planning));
  return (
    <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-auto">
      <div className="border-b border-line p-2 md:hidden">
        <MobileSidebarTrigger />
      </div>
      {masqueradeBanner && <MasqueradeBanner banner={masqueradeBanner} navigate={navigate} />}
      {planningProblem && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertDescription>
            {planningProblem === 'refused'
              ? m.app_planning_refused()
              : m.app_planning_unavailable()}
          </AlertDescription>
        </Alert>
      )}
      {orientation.visible && (
        <ProductOrientation
          key={orientation.scope}
          focusRequest={orientation.focusRequest}
          onDismiss={orientation.dismiss}
        />
      )}
      <GettingStarted />
      {hydrated && !projectionChanging ? (
        <Suspense fallback={loader}>
          <Outlet context={{ showOrientation: orientation.show } satisfies AppOutletContext} />
        </Suspense>
      ) : (
        loader
      )}
    </main>
  );
}

/** Coordinates application routes, navigation, account notices, and global dialogs. */
export function AppShell() {
  const navigate = useNavigate();
  const { paletteOpen, closePalette } = useAppShellController();
  const hydrated = useStore((state) => state.hydrated);
  const masquerade = useStore((state) => state.masquerade);
  const masqueradeBanner = buildMasqueradeBannerContent(masquerade);
  // Delegate the system preference to Sonner so it follows live OS changes without a shell rerender;
  // explicit light and dark preferences pass through as concrete schemes.
  const themePreference = useStore((state) => state.theme);
  const accounts = useStore((state) => state.data.accounts);
  const accountSummaries = useStore((state) => state.accountSummaries);
  const accountSummariesAmbiguous = useStore((state) => state.accountSummariesAmbiguous);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const activeAccountLoadFailed = useStore((state) => state.activeAccountLoadFailed);
  // Account summaries keep the tenant gate valid while the selected company's authoritative slice is still loading. Child content remains behind its hydration boundary.
  const activeAccount =
    accounts.find((account) => account.id === activeAccountId) ??
    accountSummaries.find((a) => a.id === activeAccountId);
  const accountRoute =
    matchPath({ path: ACCOUNT_LINK.to, end: true }, useLocation().pathname) !== null;

  const dirtyForm = useStore((state) => state.dirtyForm);
  const sidebarOpen = useStore((state) => state.sidebarOpen);
  const setSidebarOpen = useStore((state) => state.setSidebarOpen);

  return (
    <>
      <AppShellToaster theme={themePreference} />
      <GatedApp
        hydrated={hydrated}
        hasActiveAccount={activeAccount !== undefined}
        ambiguousAccountDirectory={accountSummariesAmbiguous}
        allowWithoutActiveAccount={
          accountRoute || (masquerade.kind !== 'inactive' && masquerade.state !== undefined)
        }
        activeAccountId={activeAccountId}
        activeAccountLoadFailed={activeAccountLoadFailed}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        activeAccount={activeAccount}
        dirtyForm={dirtyForm}
        paletteOpen={paletteOpen}
        closePalette={closePalette}
        masqueradeBanner={masqueradeBanner}
        navigate={navigate}
      />
    </>
  );
}
