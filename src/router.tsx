/* eslint-disable react-refresh/only-export-components -- route config, not a component module */
import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";
import { PUBLIC_AUTH_ENTRY_PATHS } from "./auth/authEntryRoute";
import { AppShell } from "./components/AppShell";
import { SchedulerView } from "./components/scheduler/SchedulerView";
import { RouteError } from "./components/common/ErrorBoundary";
import { NotFound } from "./components/common/NotFound";
import { useStore } from "./store/useStore";
import { hasDisciplinesEnabled } from "./store/selectors";
import { m } from "@/i18n";
import { usePermissionStatus, useRole } from "./auth/permissionContext";
import { resolveCapacityOverviewAccessDecision } from "./auth/capacityOverviewAccess";
import { resolveCapacityOverviewAccess } from "./store/selectors";
import { useDiagnosticsAccessDecision } from "./components/diagnostics/useDiagnosticsAccessDecision";
import { ROUTE_HELP } from "./lib/tourAnchors";

// The scheduler is the index route (first paint) so it stays eager. The CRUD list
// pages are split out, not needed until navigated to, which trims the initial
// bundle. AppShell wraps <Outlet> in a Suspense boundary for these lazy chunks.
const ResourceList = lazy(() =>
  import("./components/resources/ResourceList").then((resource) => ({ default: resource.ResourceList })),
);
const CapacityOverviewView = lazy(() =>
  import("./components/capacity-overview/CapacityOverviewView").then((module) => ({
    default: module.CapacityOverviewView,
  })),
);
const DisciplineList = lazy(() =>
  import("./components/disciplines/DisciplineList").then((discipline) => ({ default: discipline.DisciplineList })),
);
const ClientList = lazy(() =>
  import("./components/clients/ClientList").then((client) => ({ default: client.ClientList })),
);
const ProjectList = lazy(() =>
  import("./components/projects/ProjectList").then((project) => ({ default: project.ProjectList })),
);
const ActivityList = lazy(() =>
  import("./components/activities/ActivityList").then((activity) => ({ default: activity.ActivityList })),
);
const TimeOffList = lazy(() =>
  import("./components/timeoff/TimeOffList").then((timeOffEntry) => ({ default: timeOffEntry.TimeOffList })),
);
const TeamAccessView = lazy(() =>
  import("./components/team/TeamAccessView").then((module) => ({ default: module.TeamAccessView })),
);
const SettingsView = lazy(() =>
  import("./components/settings/SettingsView").then((module) => ({ default: module.SettingsView })),
);
const DiagnosticsView = lazy(() =>
  import("./components/diagnostics/DiagnosticsView").then((module) => ({ default: module.DiagnosticsView })),
);
const AccountView = lazy(() =>
  import("./components/account/AccountView").then((module) => ({ default: module.AccountView })),
);
const HelpView = lazy(() => import("./components/HelpView").then((module) => ({ default: module.HelpView })));
// Keep invite acceptance outside the tenant gate so a new identity can inspect and
// accept an invitation before selecting a company. Load its route only when opened.
const InviteAccept = lazy(() =>
  import("./components/invites/InviteAccept").then((module) => ({ default: module.InviteAccept })),
);
const JoinCompany = lazy(() =>
  import("./components/join/JoinCompany").then((module) => ({ default: module.JoinCompany })),
);
// Keep password reset outside tenant and login gates so a visitor without a session
// can redeem a reset link.
const ResetPassword = lazy(() => import("./auth/ResetPassword").then((module) => ({ default: module.ResetPassword })));

/** Shows a localized loading status while route access is unresolved. */
export function RouteLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <p role="status" className="text-sm text-muted-foreground">
        {m.app_loading()}
      </p>
    </main>
  );
}

// Disciplines is an optional feature (account.disciplinesEnabled). When off, the nav
// entry is hidden, guard the route too so a direct URL / bookmark can't reach the page.
function DisciplineRoute() {
  const enabled = useStore((state) => hasDisciplinesEnabled(state.data, state.activeAccountId));
  return enabled ? <DisciplineList /> : <Navigate to="/" replace />;
}

/** Renders the capacity overview only when account access is allowed. */
export function CapacityOverviewRoute() {
  const role = useRole();
  const status = usePermissionStatus();
  const access = useStore((state) => resolveCapacityOverviewAccess(state.data, state.activeAccountId));
  const decision = resolveCapacityOverviewAccessDecision({ role, status, access });
  if (decision === "pending")
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        {m.app_loading()}
      </p>
    );
  return decision === "allowed" ? <CapacityOverviewView /> : <Navigate to="/" replace />;
}

/** Renders diagnostics only for authorized owners or administrators. */
export function DiagnosticsRoute() {
  const decision = useDiagnosticsAccessDecision();
  if (decision === "pending")
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        {m.app_loading()}
      </p>
    );
  return decision === "allowed" ? <DiagnosticsView /> : <Navigate to="/" replace />;
}

function ActivityRoute() {
  const { hash } = useLocation();
  const encodedId = hash.startsWith("#activity=") ? hash.slice("#activity=".length) : "";
  let selectedActivityId: string | undefined;
  try {
    selectedActivityId = encodedId ? decodeURIComponent(encodedId) : undefined;
  } catch {
    // A malformed bookmark still opens the complete list without selecting an arbitrary row.
  }
  return <ActivityList {...(selectedActivityId === undefined ? {} : { selectedActivityId })} />;
}

/** Defines the application routes and their authentication and error boundaries. */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    // Surface render failures through the branded recovery boundary.
    errorElement: <RouteError />,
    children: [
      { index: true, element: <SchedulerView /> },
      { path: "overview", element: <CapacityOverviewRoute /> },
      { path: "resources", element: <ResourceList /> },
      // Preserve the legacy external-resource bookmark by redirecting it to Resources.
      { path: "external", element: <Navigate to="/resources" replace /> },
      { path: "disciplines", element: <DisciplineRoute /> },
      { path: "clients", element: <ClientList /> },
      { path: "projects", element: <ProjectList /> },
      { path: "activities", element: <ActivityRoute /> },
      { path: "timeoff", element: <TimeOffList /> },
      { path: "team", element: <TeamAccessView /> },
      { path: "settings", element: <SettingsView /> },
      { path: "diagnostics", element: <DiagnosticsRoute /> },
      { path: "account", element: <AccountView /> },
      { path: ROUTE_HELP.slice(1), element: <HelpView /> },
    ],
  },
  {
    // This public route owns its loading and error boundaries because the tenant shell
    // cannot wrap onboarding before a company is selected.
    path: PUBLIC_AUTH_ENTRY_PATHS.invitation,
    errorElement: <RouteError />,
    element: (
      <Suspense fallback={<RouteLoading />}>
        <InviteAccept />
      </Suspense>
    ),
  },
  {
    path: PUBLIC_AUTH_ENTRY_PATHS.companyJoin,
    errorElement: <RouteError />,
    element: (
      <Suspense fallback={<RouteLoading />}>
        <JoinCompany />
      </Suspense>
    ),
  },
  {
    // This public recovery route needs its own loading and error boundaries because
    // visitors redeeming reset links may have no session or company.
    path: PUBLIC_AUTH_ENTRY_PATHS.passwordReset,
    errorElement: <RouteError />,
    element: (
      <Suspense fallback={<RouteLoading />}>
        <ResetPassword />
      </Suspense>
    ),
  },
  {
    // A navigation miss is not a render failure. Keep it out of RouteError's reload-only path and
    // give stale bookmarks and mistyped URLs a stable route back into the product.
    path: "*",
    element: <NotFound />,
    errorElement: <RouteError />,
  },
]);
