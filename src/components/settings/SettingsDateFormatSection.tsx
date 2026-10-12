import { m } from "@/i18n";
import { buildLabels, buildLabelOptions } from "@/lib/metadata";
import { SegmentedControl } from "@/components/common/ui";
import { SettingsSection } from "./SettingsSection";
import { DATE_STYLE_MESSAGES } from "./settingsLabels";

import type { DateStyle } from "@capacitylens/shared/types/entities";

/** Renders the company date convention for editors and higher roles so members read the same schedule format. */
export function SettingsDateFormatSection({
  canEdit,
  dateStyle,
  onChange,
}: {
  canEdit: boolean;
  dateStyle: DateStyle;
  onChange: (style: DateStyle) => void;
}) {
  return (
    <SettingsSection title={m.settings_date_style_heading()} help={m.settings_date_style_intro()}>
      <SegmentedControl
        variant="recessed"
        ariaLabel={m.settings_date_style_aria()}
        value={dateStyle}
        onChange={onChange}
        options={buildLabelOptions(buildLabels(DATE_STYLE_MESSAGES))}
        disabled={!canEdit}
        fullWidth
        density="compact"
      />
    </SettingsSection>
  );
}
