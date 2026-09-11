import { Suspense, type CSSProperties } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { GettingStartedShortcut } from "./GettingStarted";
import { Toaster } from "sonner";
import { useStore } from "../store/useStore";
import { hasDisciplinesEnabled } from "../store/selectors";
import { useDemoAuthActive } from "../lib/fakeAuth";
import { CommandPalette } from "./CommandPalette";
import { PermissionProvider } from "../auth/PermissionProvider";
import { RotateHint } from "./RotateHint";
import { Spinner } from "./ui/spinner";
import { Alert, AlertDescription } from "./ui/alert";
import { m } from "@/i18n";
import { ADMIN_LINKS, LINKS } from "../lib/navLinks";
import { useOfflineState } from "../data/useOfflineState";
import { AppEntryGate } from "./AppEntryGate";
import { useAppShellController } from "./useAppShellController";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarTrigger, useSidebar } from "./ui/sidebar";
import { transitionAccount } from "../auth/accountTransition";
import { masqueradeController } from "../auth/masqueradeController";
import { Button } from "./ui/button";

const masqueradeButtonClassName = "border-white/70 bg-transparent text-white hover:bg-white/15 hover:text-white";

function buildMasqueradeBannerContent(masquerade: ReturnType<typeof useStore.getState>["masquerade"]) {
  switch (masquerade.kind) {
    case "inactive":
      return null;
    case "starting":
      return {
        label: m.app_masquerade_starting(),
        showControls: masquerade.state !== undefined,
        showRetryProjection: true,
        endLabel: m.app_masquerade_end_now(),
      };
    case "active":
      return {
        label: m.app_masquerading_as({ name: masquerade.state.targetName }),
        showControls: true,
        showRetryProjection: false,
        endLabel: m.app_masquerade_end_now(),
      };
    case "ending":
      return {
        label: m.app_masquerade_ending(),
        showControls: true,
        showRetryProjection: false,
        endLabel: m.app_masquerade_retry(),
      };
  }
}

function MobileSidebarTrigger() {
  const { openMobile } = useSidebar();
  return (
    <SidebarTrigger aria-expanded={openMobile} aria-label={openMobile ? m.nav_collapse_menu() : m.nav_expand_menu()} />
  );
}

function AppShellLoader() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Spinner role="presentation" aria-label={undefined} />
      {m.app_loading()}
    </div>
  );
}

function AppShellToaster({ theme }: { theme: ReturnType<typeof useStore.getState>["theme"] }) {
  return (
    <Toaster
      theme={theme === "system" ? "system" : theme}
      position="bottom-center"
      closeButton
      toastOptions={{ classNames: { error: "toast-error" } }}
      style={
        {
          "--normal-bg": "var(--color-elevated)",
          "--normal-text": "var(--color-ink)",
          "--normal-border": "var(--color-line)",
        } as CSSProperties
      }
    />
  );
}

type GatedAppProps = {
  hydrated: boolean;
  connectionError: ReturnType<typeof useStore.getState>["connectionError"];
  loadError: ReturnType<typeof useStore.getState>["loadError"];
  demoAuthActive: boolean;
  fakeSignedIn: boolean;
  hasActiveAccount: boolean;
  introSeen: boolean;
  onFakeSignIn: () => void;
  onIntroContinue: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activeAccount:
    | ReturnType<typeof useStore.getState>["data"]["accounts"][number]
    | ReturnType<typeof useStore.getState>["accountSummaries"][number]
    | undefined;
  navLinks: typeof LINKS;
  signOutDemo: () => void;
  dirtyForm: boolean;
  paletteOpen: boolean;
  closePalette: () => void;
  offline: ReturnType<typeof useOfflineState>;
  persistError: ReturnType<typeof useStore.getState>["persistError"];
  masqueradeBanner: ReturnType<typeof buildMasqueradeBannerContent>;
  navigate: ReturnType<typeof useNavigate>;
};

function GatedApp({
  hydrated,
  connectionError,
  loadError,
  demoAuthActive,
  fakeSignedIn,
  hasActiveAccount,
  introSeen,
  onFakeSignIn,
  onIntroContinue,
  sidebarOpen,
  setSidebarOpen,
  activeAccount,
  navLinks,
  signOutDemo,
  dirtyForm,
  paletteOpen,
  closePalette,
  offline,
  persistError,
  masqueradeBanner,
  navigate,
}: GatedAppProps) {
  return (
    <AppEntryGate
      hydrated={hydrated}
      connectionError={connectionError}
      loadError={loadError}
      demoAuthActive={demoAuthActive}
      fakeSignedIn={fakeSignedIn}
      hasActiveAccount={hasActiveAccount}
      introSeen={introSeen}
      onFakeSignIn={onFakeSignIn}
      onIntroContinue={onIntroContinue}
    >
      <PermissionProvider>
        <SidebarProvider
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          className="h-full min-h-0"
          style={{ "--sidebar-width": "12rem", "--sidebar-width-icon": "3.5rem" } as CSSProperties}
        >
          <GatedSidebar
            activeAccount={activeAccount}
            navLinks={navLinks}
            demoAuthActive={demoAuthActive}
            signOutDemo={signOutDemo}
            sidebarOpen={sidebarOpen}
          />
          {/* Keep the main surface isolated so this shell remains an orchestration boundary. */}
          {/* prettier-ignore */}
          <GatedMain hydrated={hydrated} offline={offline} persistError={persistError} masqueradeBanner={masqueradeBanner} navigate={navigate} />
          {paletteOpen && !dirtyForm && <CommandPalette onClose={closePalette} />}
          <RotateHint />
        </SidebarProvider>
      </PermissionProvider>
    </AppEntryGate>
  );
}

function GatedSidebar({
  activeAccount,
  navLinks,
  demoAuthActive,
  signOutDemo,
  sidebarOpen,
}: Pick<GatedAppProps, "activeAccount" | "navLinks" | "demoAuthActive" | "signOutDemo" | "sidebarOpen">) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-(--z-index-skip-link) focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-ink focus:shadow focus:ring-2 focus:ring-brand"
      >
        {m.nav_skip_to_content()}
      </a>
      <AppSidebar
        activeAccount={activeAccount}
        adminLinks={ADMIN_LINKS}
        demoAuthActive={demoAuthActive}
        navLinks={navLinks}
        onSignOut={signOutDemo}
        onSwitchAccount={() => void transitionAccount(null)}
        open={sidebarOpen}
      />
    </>
  );
}

function GatedMain({
  hydrated,
  offline,
  persistError,
  masqueradeBanner,
  navigate,
}: Pick<GatedAppProps, "hydrated" | "offline" | "persistError" | "masqueradeBanner" | "navigate">) {
  const loader = <AppShellLoader />;
  return (
    <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-auto">
      <div className="border-b border-line p-2 md:hidden">
        <MobileSidebarTrigger />
      </div>
      {masqueradeBanner && <MasqueradeBanner banner={masqueradeBanner} navigate={navigate} />}
      {offline.readOnly && (
        <Alert role="status" data-testid="offline-read-only" className="rounded-none border-x-0 border-t-0">
          <AlertDescription>
            {m.app_offline_read_only({
              updated: offline.lastUpdated
                ? new Date(offline.lastUpdated).toLocaleString()
                : m.app_offline_unknown_time(),
            })}
          </AlertDescription>
        </Alert>
      )}
      {persistError && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertDescription>{m.app_persist_error()}</AlertDescription>
        </Alert>
      )}
      <GettingStartedShortcut />
      {hydrated ? (
        <Suspense fallback={loader}>
          <Outlet />
        </Suspense>
      ) : (
        loader
      )}
    </main>
  );
}

function MasqueradeBanner({
  banner,
  navigate,
}: {
  banner: Exclude<ReturnType<typeof buildMasqueradeBannerContent>, null>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <Alert
      role="status"
      data-testid="masquerade-banner"
      className="rounded-none border-x-0 border-t-0 border-danger bg-danger text-white *:data-[slot=alert-description]:text-white"
    >
      <AlertDescription className="flex w-full grid-cols-none flex-row items-center justify-between gap-3">
        <span>{banner.label}</span>
        {banner.showControls && (
          <span className="flex gap-2">
            {banner.showRetryProjection && (
              <Button
                size="sm"
                variant="outline"
                className={masqueradeButtonClassName}
                onClick={() => void masqueradeController.retryProjection()}
              >
                {m.app_masquerade_retry()}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className={masqueradeButtonClassName}
              onClick={() => void masqueradeController.end("explicit", (to) => void navigate(to))}
            >
              {banner.endLabel}
            </Button>
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const { paletteOpen, closePalette } = useAppShellController();
  const hydrated = useStore((state) => state.hydrated);
  const persistError = useStore((state) => state.persistError);
  const loadError = useStore((state) => state.loadError);
  const connectionError = useStore((state) => state.connectionError);
  const masquerade = useStore((state) => state.masquerade);
  const masqueradeBanner = buildMasqueradeBannerContent(masquerade);
  const offline = useOfflineState();
  // Drives Sonner's theme (see the <Toaster> below). An explicit light|dark pref is passed
  // through as the concrete scheme; a 'system' pref is delegated to Sonner ('system'), which
  // subscribes to prefers-color-scheme itself and so stays live when the OS flips (this shell
  // wouldn't re-render on that, which is why we don't resolve 'system' here).
  const themePreference = useStore((state) => state.theme);
  const accounts = useStore((state) => state.data.accounts);
  const accountSummaries = useStore((state) => state.accountSummaries);
  const activeAccountId = useStore((state) => state.activeAccountId);
  // EXISTENCE of the active account from `data.accounts` (after the slice loads, it holds exactly the
  // active account) OR `accountSummaries` (P1.13 — covers the pick→slice-load gap in server mode,
  // where `data` is empty for one frame until the switch orchestrator hydrates the slice). The summary
  // is enough to pass the tenant gate and render the shell; the slice fills in the body a frame later.
  const activeAccount =
    accounts.find((account) => account.id === activeAccountId) ??
    accountSummaries.find((a) => a.id === activeAccountId);
  // Cosmetic demo sign-in (see the gate below). `demoAuthActive` is true only when the real
  // auth seam is OFF, so the demo gate and the real login wall never double-gate.
  const demoAuthActive = useDemoAuthActive();
  const fakeSignedIn = useStore((state) => state.fakeSignedIn);
  const setFakeSignedIn = useStore((state) => state.setFakeSignedIn);
  const signOutDemo = useStore((state) => state.signOutDemo);
  // Post-login intro gate (see below). Device-global, once-per-device flag.
  const introSeen = useStore((state) => state.introSeen);
  const setIntroSeen = useStore((state) => state.setIntroSeen);
  // Drop the Disciplines destination from the nav when the active account doesn't use
  // disciplines (the route itself is also guarded — see router.tsx).
  const disciplinesEnabled = useStore((state) => hasDisciplinesEnabled(state.data, state.activeAccountId));
  const navLinks = disciplinesEnabled ? LINKS : LINKS.filter(({ to }) => to !== "/disciplines");

  const dirtyForm = useStore((state) => state.dirtyForm);
  const sidebarOpen = useStore((state) => state.sidebarOpen);
  const setSidebarOpen = useStore((state) => state.setSidebarOpen);

  return (
    <>
      <AppShellToaster theme={themePreference} />
      <GatedApp
        hydrated={hydrated}
        connectionError={connectionError}
        loadError={loadError}
        demoAuthActive={demoAuthActive}
        fakeSignedIn={fakeSignedIn}
        hasActiveAccount={activeAccount !== undefined}
        introSeen={introSeen}
        onFakeSignIn={() => setFakeSignedIn(true)}
        onIntroContinue={() => setIntroSeen(true)}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        activeAccount={activeAccount}
        navLinks={navLinks}
        signOutDemo={signOutDemo}
        dirtyForm={dirtyForm}
        paletteOpen={paletteOpen}
        closePalette={closePalette}
        offline={offline}
        persistError={persistError}
        masqueradeBanner={masqueradeBanner}
        navigate={navigate}
      />
    </>
  );
}
