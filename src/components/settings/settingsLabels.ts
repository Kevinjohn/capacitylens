import { m } from "@/i18n";
import type { InternalColourMode, SchedulingMode } from "@capacitylens/shared/types/entities";
import type { BarLabelPrefs, UtilizationPrefs } from "../../lib/displayPrefs";
import { type LabelMessages } from "../../lib/metadata";
import type { ThemePref } from "../../lib/theme";

// Module-scope option tables hold UNCALLED message references (`m.key`, never `m.key()`) and are
// resolved at RENDER through metadata.ts's `labelsFrom`/`toOptions` — the same lazy rule the enum
// tables there follow (the AppShell LINKS pattern, P1.5.2). Resolving `m.key()` at import would
// freeze each label to the load-time locale; deferring it to render lets an account/locale switch
// re-resolve the text. Keying each table by its own union also makes it exhaustive by type: add a
// theme/mode/preference without a message here and tsc fails.
export const THEME_MESSAGES: LabelMessages<ThemePref> = {
  light: m.settings_theme_light,
  dark: m.settings_theme_dark,
  system: m.settings_theme_system,
};

export const SCHEDULING_MESSAGES: LabelMessages<SchedulingMode> = {
  hourly: m.settings_scheduling_option_hours,
  days: m.settings_scheduling_option_days,
  blocks: m.settings_scheduling_option_blocks,
};

export const INTERNAL_COLOUR_MESSAGES: LabelMessages<InternalColourMode> = {
  grey: m.settings_internal_colours_grey,
  palette: m.settings_internal_colours_palette,
};

export const UTILIZATION_MESSAGES: LabelMessages<keyof UtilizationPrefs> = {
  showTotal: m.settings_utilisation_show_total,
  showDiscipline: m.settings_utilisation_show_discipline,
  showPersonal: m.settings_utilisation_show_personal,
};

export const BAR_LABEL_MESSAGES: LabelMessages<keyof BarLabelPrefs> = {
  showClient: m.settings_bar_labels_show_client,
  showProject: m.settings_bar_labels_show_project,
};
