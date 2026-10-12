import { m } from "@/i18n";
import type { CapacityOverviewAccess, SchedulingMode } from "@capacitylens/shared/types/entities";
import type { BarLabelPreferences, UtilizationPreferences } from "@/lib/displayPrefs";
import type { LabelMessages } from "@/lib/metadata";
import type { ThemePreference } from "@/lib/theme";
import type { DateStyle } from "@capacitylens/shared/types/entities";

// Store exhaustive message-function tables and resolve them at render so account locale changes update labels without rebuilding module state.
/** Localized labels for device theme choices. */
export const THEME_MESSAGES: LabelMessages<ThemePreference> = {
  light: m.settings_theme_light,
  dark: m.settings_theme_dark,
  system: m.settings_theme_system,
};

/** Localized labels for account date conventions. */
export const DATE_STYLE_MESSAGES: LabelMessages<DateStyle> = {
  "day-month": m.settings_date_style_day_month,
  "day-ordinal-month": m.settings_date_style_day_ordinal_month,
  "month-day": m.settings_date_style_month_day,
  "month-day-ordinal": m.settings_date_style_month_day_ordinal,
};

/** Localized labels for account scheduling modes. */
export const SCHEDULING_MESSAGES: LabelMessages<SchedulingMode> = {
  hourly: m.settings_scheduling_option_hours,
  days: m.settings_scheduling_option_days,
  blocks: m.settings_scheduling_option_blocks,
};

/** Localized labels for capacity overview access choices. */
export const CAPACITY_OVERVIEW_ACCESS_MESSAGES: LabelMessages<CapacityOverviewAccess> = {
  owner_admin: m.settings_capacity_overview_access_owner_admin,
  owner_admin_editor: m.settings_capacity_overview_access_owner_admin_editor,
  everyone: m.settings_capacity_overview_access_everyone,
};

/** Localized labels for utilization display preferences. */
export const UTILIZATION_MESSAGES: LabelMessages<keyof UtilizationPreferences> = {
  showTotal: m.settings_utilisation_show_total,
  showDiscipline: m.settings_utilisation_show_discipline,
  showPersonal: m.settings_utilisation_show_personal,
};

/** Localized labels for schedule bar content preferences. */
export const BAR_LABEL_MESSAGES: LabelMessages<keyof BarLabelPreferences> = {
  showClient: m.settings_bar_labels_show_client,
  showProject: m.settings_bar_labels_show_project,
};
