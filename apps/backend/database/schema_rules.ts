import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator';

const weekdays = { tsType: "import('@capacitylens/shared/types/entities').Weekday[]" };

export default {
  types: {
    date: {
      tsType: "import('@capacitylens/shared/types/entities').ISODate",
      decorators: [{ name: '@column' }],
    },
  },
  columns: {
    working_days: weekdays,
    half_days: weekdays,
  },
  tables: {
    companies: {
      columns: {
        scheduling_mode: {
          tsType: "import('@capacitylens/shared/types/entities').SchedulingMode",
        },
        week_starts_on: { tsType: '0 | 1' },
        capacity_overview_access: {
          tsType: "import('@capacitylens/shared/types/entities').CapacityOverviewAccess",
        },
        date_style: {
          tsType: "import('@capacitylens/shared/types/entities').DateStyle",
        },
      },
    },
    activities: {
      columns: {
        kind: { tsType: "import('@capacitylens/shared/types/entities').ActivityKind" },
      },
    },
    allocations: {
      columns: {
        status: { tsType: "import('@capacitylens/shared/types/entities').AllocationStatus" },
      },
    },
    resources: {
      columns: {
        kind: { tsType: "import('@capacitylens/shared/types/entities').ResourceKind" },
        employment_type: {
          tsType: "import('@capacitylens/shared/types/entities').EmploymentType",
        },
        engagement: {
          tsType: "import('@capacitylens/shared/types/entities').ResourceEngagement",
        },
      },
    },
    time_off: {
      columns: {
        type: { tsType: "import('@capacitylens/shared/types/entities').TimeOffType" },
      },
    },
    // Account Kit's Lucid adapter reads and writes these as Luxon values.
    users: {
      columns: {
        created_at: {
          tsType: "import('@capacitylens/shared/types/entities').ISOTimestamp",
          decorators: [{ name: '@column' }],
        },
        updated_at: {
          tsType: "import('@capacitylens/shared/types/entities').ISOTimestamp",
          decorators: [{ name: '@column' }],
        },
        email_verified_at: {
          tsType: "import('luxon').DateTime | null",
          decorators: [{ name: '@column.dateTime' }],
        },
        credentials_changed_at: {
          tsType: "import('luxon').DateTime | null",
          decorators: [{ name: '@column.dateTime' }],
        },
      },
    },
    audit_entries: {
      columns: {
        details: { tsType: 'unknown' },
      },
    },
    company_settings: {
      columns: {
        value: { tsType: 'unknown' },
      },
    },
  },
} satisfies SchemaRules;
