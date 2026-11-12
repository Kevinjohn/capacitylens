import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import type { RenderOptions } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PermissionContext } from './permissionContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PrivateNameFields } from '@/components/common/PrivateNameFields';
import { usePrivateNameFields } from '@/components/common/usePrivateNameFields';
import { TimeOffForm } from '@/components/timeoff/TimeOffForm';
import { m } from '@/i18n';

// Isolated AllocationBar renders need a tooltip provider.
const render = (ui: ReactNode, options?: Omit<RenderOptions, 'wrapper'>) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });
import { AddButton, ListPage } from '@/components/common/ui';
import { AllocationBar } from '@/components/scheduler/AllocationBar';
import { buildColumnGeometry } from '@/components/scheduler/columnGeometry';
import type { BarLayout } from '@/components/scheduler/schedulerModel';
import { eachDayISO } from '@capacitylens/shared/lib/dateMath';
import { useStore } from '@/store/useStore';
import { requireCreated } from '@/test/requireCreated';
import { loadPlanningData, resetStoreWithAccount, makeResourceDraft } from '@/test/fixtures';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { Allocation } from '@capacitylens/shared/types/entities';
import type { Role } from '@capacitylens/shared/domain/access';

// Verify UI affordances and the store's local guard; server authorization remains authoritative.
function withRole(role: Role | null, ui: ReactNode) {
  return render(<PermissionContext.Provider value={{ role }}>{ui}</PermissionContext.Provider>);
}

function PrivateNameFieldsHarness() {
  const fields = usePrivateNameFields({ isPrivate: true, codeName: 'Cipher' }, vi.fn());
  return <PrivateNameFields fields={fields} errorField={null} errorId="private-name-error" />;
}

beforeEach(() => {
  loadPlanningData(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setActiveRole(null);
  useStore.getState().setNotice(null);
});

describe('useCanEdit gates the ListPage create affordance', () => {
  const onAdd = vi.fn();

  it('a viewer sees NO "Add" button', () => {
    withRole('viewer', <ListPage title="Clients" addLabel="Add client" onAdd={onAdd} />);
    expect(screen.queryByRole('button', { name: 'Add client' })).not.toBeInTheDocument();
  });

  it.each(['editor', 'owner', 'admin'] as const)('an %s sees the "Add" button', (role) => {
    withRole(role, <ListPage title="Clients" addLabel="Add client" onAdd={onAdd} />);
    expect(screen.getByRole('button', { name: 'Add client' })).toBeInTheDocument();
  });

  it('role null hides the "Add" button', () => {
    withRole(null, <ListPage title="Clients" addLabel="Add client" onAdd={onAdd} />);
    expect(screen.queryByRole('button', { name: 'Add client' })).not.toBeInTheDocument();
  });

  it('fails closed when the permission provider is missing', () => {
    render(<ListPage title="Clients" addLabel="Add client" onAdd={onAdd} />);
    expect(screen.queryByRole('button', { name: 'Add client' })).not.toBeInTheDocument();
  });
});

describe('useCanEdit gates direct AddButton create affordances', () => {
  it('hides a direct create action from a viewer by default', () => {
    withRole('viewer', <AddButton label="Add placeholder" onClick={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add placeholder' })).not.toBeInTheDocument();
  });
});

describe('useCanEdit gates the AllocationBar resize grips', () => {
  const GEOM = buildColumnGeometry(eachDayISO('2026-06-01', '2026-06-30'), 48, {
    minimiseWeekends: false,
    weekendWidth: 22,
  });
  const indexAtClientX = (clientX: number) => GEOM.indexAt(clientX);
  const allocation: Allocation = {
    ...NULLABLE_FIELDS.allocations,
    id: 'alloc-1',
    accountId: 'acct-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    resourceId: 'res-1',
    activityId: 'activity-1',
    startDate: '2026-06-01',
    endDate: '2026-06-07',
    hoursPerDay: 8,
    status: 'confirmed',
  };
  const bar: BarLayout = {
    allocation,
    x: 0,
    width: 336,
    top: 0,
    color: '#ec4899',
    label: 'My Activity',
    external: false,
  };

  it('a viewer bar has NO resize grips and is not an edit button', () => {
    withRole(
      'viewer',
      <AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    expect(screen.queryByTestId('resize-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-end')).not.toBeInTheDocument();

    expect(screen.getByTestId('allocation-bar')).toHaveAttribute('role', 'img');
  });

  it('an editor bar HAS resize grips and is an edit button', () => {
    withRole(
      'editor',
      <AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    expect(screen.getByTestId('resize-start')).toBeInTheDocument();
    expect(screen.getByTestId('resize-end')).toBeInTheDocument();
    expect(screen.getByTestId('allocation-bar')).toHaveAttribute('role', 'button');
  });

  it('role null / no provider hides resize grips', () => {
    render(
      <AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    expect(screen.queryByTestId('resize-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-end')).not.toBeInTheDocument();
  });
});

describe('private name fields require a resolved role', () => {
  it('hides private name controls and protects an existing name when role is null', () => {
    withRole(null, <PrivateNameFieldsHarness />);

    expect(
      screen.queryByRole('switch', { name: m.form_private_toggle_label() }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: m.form_private_code_name_label() }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(m.form_private_owner_only_hint())).toBeInTheDocument();
  });

  it('hides TimeOff notes when the permission provider has no resolved role', async () => {
    await resetStoreWithAccount();
    const resource = await requireCreated(useStore.getState().addResource(makeResourceDraft()));

    render(
      <PermissionContext.Provider value={{ role: null }}>
        <TimeOffForm
          defaults={{ resourceId: resource.id, startDate: '2026-06-01', endDate: '2026-06-01' }}
          onClose={vi.fn()}
        />
      </PermissionContext.Provider>,
    );

    expect(screen.queryByLabelText('Note')).not.toBeInTheDocument();
  });
});

describe('store viewer guard (defense-in-depth) no-ops a viewer mutation', () => {
  beforeEach(() => resetStoreWithAccount());

  it('add*/update*/delete* NO-OP for a viewer and surface a read-only notice', async () => {
    useStore.getState().setActiveRole('viewer');

    const result = await useStore.getState().addResource(makeResourceDraft());
    expect(result).toEqual({ kind: 'blocked' });
    expect(useStore.getState().data.resources).toHaveLength(0);
    expect(useStore.getState().notice?.message).toMatch(/read-only/i);

    useStore.getState().setActiveRole('owner');
    const seeded = await requireCreated(
      useStore.getState().addResource(makeResourceDraft({ name: 'Seeded' })),
    );
    expect(useStore.getState().data.resources).toHaveLength(1);

    useStore.getState().setActiveRole('viewer');
    await useStore.getState().updateResource(seeded.id, { name: 'Renamed' });
    expect(useStore.getState().data.resources[0]?.name).toBe('Seeded');

    expect(useStore.getState().data.resources).toHaveLength(1);
  });

  it.each(['editor', 'owner', 'admin'] as const)(
    'role %s permits the mutation outside masquerade',
    async (role) => {
      useStore.getState().setActiveRole(role);
      const r = await requireCreated(useStore.getState().addResource(makeResourceDraft()));
      expect(useStore.getState().data.resources.some((x) => x.id === r.id)).toBe(true);
    },
  );

  it.each([
    ['pending', /membership is being verified/i],
    ['unavailable', /role could not be verified/i],
  ] as const)(
    'attributes a %s fail-closed mutation to role resolution, not Viewer membership',
    async (status, message) => {
      useStore.getState().setActiveRole('viewer', status);

      await useStore.getState().addResource(makeResourceDraft());

      expect(useStore.getState().data.resources).toHaveLength(0);
      expect(useStore.getState().notice?.message).toMatch(message);
      expect(useStore.getState().notice?.message).not.toMatch(/you don't have edit access/i);
    },
  );
});
