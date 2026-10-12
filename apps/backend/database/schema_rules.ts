import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

const boolean = { tsType: 'boolean' }
const weekdays = { tsType: "import('@capacitylens/shared/types/entities').Weekday[]" }

export default {
  types: {
    date: {
      tsType: "import('@capacitylens/shared/types/entities').ISODate",
      decorators: [{ name: '@column' }],
    },
    DateTime: {
      tsType: "import('@capacitylens/shared/types/entities').ISOTimestamp",
      decorators: [{ name: '@column' }],
    },
  },
  columns: {
    created_at: {
      tsType: "import('@capacitylens/shared/types/entities').ISOTimestamp",
      decorators: [{ name: '@column' }],
    },
    updated_at: {
      tsType: "import('@capacitylens/shared/types/entities').ISOTimestamp",
      decorators: [{ name: '@column' }],
    },
    working_days: weekdays,
    half_days: weekdays,
    disciplines_enabled: boolean,
    placeholders_enabled: boolean,
    external_enabled: boolean,
    inline_activity_create_enabled: boolean,
    show_task_field_in_schedule: boolean,
    is_private: boolean,
    builtin: boolean,
    is_favourite: boolean,
    ignore_weekends: boolean,
  },
  tables: {
    accounts: {
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
    memberships: {
      columns: {
        role: { tsType: "import('@capacitylens/shared/account/types').Role" },
        status: { tsType: "import('@capacitylens/shared/account/types').MembershipStatus" },
      },
    },
    invitations: {
      columns: {
        role: { tsType: "import('@capacitylens/shared/account/types').InvitationRole" },
      },
    },
    ownership_transfers: {
      columns: {
        status: {
          tsType: "import('@capacitylens/shared/account/ownershipTransfer').OwnershipTransferState",
        },
      },
    },
    masquerades: {
      columns: {
        role: { tsType: "import('@capacitylens/shared/account/types').Role" },
      },
    },
    audit_entries: {
      columns: {
        details: { tsType: 'unknown' },
      },
    },
    command_results: {
      columns: {
        result: { tsType: 'unknown' },
      },
    },
    company_settings: {
      columns: {
        value: { tsType: 'unknown' },
      },
    },
  },
} satisfies SchemaRules
