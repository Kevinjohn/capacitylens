import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetStoreWithAccount, jsonResponse } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import { setOfflineReadState } from "@/data/offlineCache";
import { m } from "@/i18n";
import { mockApi, renderSection } from "./MembersSection.testSupport";

vi.mock("@/data/apiConfig", () => ({ API_BASE: "http://api.test", isServerConfigured: () => true }));

beforeEach(() => {
  resetStoreWithAccount();
  setOfflineReadState({ owner: "cleanup", readOnly: false });
});
afterEach(() => {
  setOfflineReadState({ owner: "cleanup", readOnly: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["missing", "rejected"])("reports invite copy failure when clipboard is %s", async (kind) => {
  const user = userEvent.setup();
  if (kind === "missing") {
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as unknown as Clipboard);
  } else {
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    } as unknown as Clipboard);
  }
  vi.stubGlobal(
    "fetch",
    mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "POST /api/invites": () => jsonResponse({ token: "TOKEN" }, 201),
    }),
  );
  renderSection();
  fireEvent.click(await screen.findByTestId("invite-open"));
  await screen.findByRole("dialog", { name: "Invite someone" });
  fireEvent.change(screen.getByTestId("invite-preauth"), { target: { value: "diana@example.test" } });
  await user.click(screen.getByTestId("invite-submit"));
  await user.click(await screen.findByRole("button", { name: "Copy invitation link" }));
  await waitFor(() =>
    expect(useStore.getState().notice).toMatchObject({ message: m.settings_members_copy_failed(), tone: "error" }),
  );
});
