import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { m } from "@/i18n";
import { TimeZoneField } from "./TimeZoneField";

describe("TimeZoneField search", () => {
  it("rejects an overlong paste and accepts a valid correction", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TimeZoneField
        label="Timezone"
        value="Etc/GMT"
        onChange={onChange}
        options={[
          { label: "London", value: "Europe/London" },
          { label: "New York", value: "America/New_York" },
        ]}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Timezone" }));
    const input = screen.getByRole("combobox", { name: m.picker_timezone_search() });
    const query = "x".repeat(256);
    await user.paste(query);
    expect(input).toHaveValue(query);

    await user.paste("y");
    expect(input).toHaveValue(query);
    expect(screen.getByRole("alert")).toHaveTextContent(m.validation_text_too_long());

    (input as HTMLInputElement).setSelectionRange(0, 256);
    await user.paste("London");
    expect(input).toHaveValue("London");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "London" })).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("Europe/London");
  });
});
