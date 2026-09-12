import { m } from "@/i18n";
import { buildLabels, buildLabelOptions } from "../../lib/metadata";
import { SegmentedControl } from "../common/ui";
import { SettingsSection } from "./SettingsSection";
import { DATE_STYLE_MESSAGES } from "./settingsLabels";

import type { DateStyle } from "@capacitylens/shared/types/entities";

/**
 * The company's date format. An ACCOUNT setting, not a device preference: a schedule where half the
 * rows read "9 Sep" and half read "Sep 9" is the problem this removes, so it cannot be per-browser.
 * That is also why it is not in the Appearance section, which is explicitly this-device-only.
 *
 * Editor and up, like every account setting except Capacity Overview access. A viewer sees the
 * control disabled rather than hidden, matching the other account sections — and the server
 * authorises the write independently, so the disabled attribute is a courtesy, not the control.
 */
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
        ariaLabel={m.settings_date_style_aria()}
        value={dateStyle}
        onChange={onChange}
        options={buildLabelOptions(buildLabels(DATE_STYLE_MESSAGES))}
        disabled={!canEdit}
      />
    </SettingsSection>
  );
}
