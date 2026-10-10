import { m } from "@/i18n";
import { resolveTimeZoneOptionLabel } from "@/lib/timezones";
import { SettingsSection } from "./SettingsSection";
import type { Account } from "@capacitylens/shared/types/entities";

type SettingsAccountOptionsProps = {
  companyName: Account["name"];
  weekStartsOn: NonNullable<Account["weekStartsOn"]>;
  timezone: NonNullable<Account["timezone"]>;
};

export function SettingsAccountOptions({ companyName, weekStartsOn, timezone }: SettingsAccountOptionsProps) {
  const weekStartLabel = weekStartsOn === 0 ? m.settings_week_start_sunday() : m.settings_week_start_monday();
  const rows = [
    [m.settings_company_name_label(), companyName],
    [m.settings_week_start_label(), weekStartLabel],
    [m.settings_timezone_label(), resolveTimeZoneOptionLabel(timezone)],
  ];
  return (
    <SettingsSection
      title={m.settings_account_options_heading()}
      description={m.settings_company_details_scope()}
      help={
        <>
          <p>{m.settings_account_options_help()}</p>
          <p>{m.settings_calendar_intro()}</p>
        </>
      }
      contentClassName="gap-0"
    >
      <table className="w-full table-fixed text-sm">
        <tbody className="divide-y divide-line">
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className="py-1 pr-4 text-left font-medium text-muted-foreground">
                {label}
              </th>
              <td className="py-1 text-right text-ink">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </SettingsSection>
  );
}
