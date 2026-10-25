import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, jsonResponse } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import { m } from "@/i18n";
import { expectNotice, mockApi, ownerAndEditor, rawMember, renderSection } from "./MembersSection.testSupport";

interface InviteFailureCaseInput {
  status: number;
  body: { error: string };
  expected: RegExp;
  fieldError: boolean;
}

interface InviteReconciliationCaseInput {
  status: number;
  body: { error: string };
  expected: RegExp;
  reconciles: boolean;
}

const accountTransitionMocks = vi.hoisted(() => ({
  startMasquerade: vi.fn(async () => true),
}));

vi.mock("@/auth/accountTransition", () => ({
  startMasquerade: accountTransitionMocks.startMasquerade,
}));

vi.mock("@/data/apiConfig", () => ({
  API_BASE: "http://api.test",
  isServerConfigured: () => true,
}));

beforeEach(async () => {
  accountTransitionMocks.startMasquerade.mockClear();
  await resetStoreWithAccount();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderInviteSection(): Promise<void> {
  renderSection();
  await screen.findByTestId("invite-open");
  fireEvent.click(screen.getByTestId("invite-open"));
  await screen.findByRole("dialog", { name: "Invite someone" });
}

function fillAddressedInvite(): void {
  fireEvent.change(screen.getByTestId("invite-preauth"), { target: { value: "diana@example.test" } });
}

function closeInviteDialog(): void {
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Invite someone" })).getByRole("button", { name: "Cancel" }),
  );
}

describe("MembersSection — invite mint", () => {
  registerInviteCopyControlTests();
  registerInviteDeadlineTests();
  registerInviteReloadTests();
  registerInviteMutationTransitionTests();
  registerInviteValidationTests();
  registerInviteCreationFailureTests();
  registerInviteRevokeFailureTests();
});

function registerInviteCopyControlTests(): void {
  it("places Invite someone before the member table", async () => {
    vi.stubGlobal("fetch", mockApi([{ userId: "me", role: "owner", isSelf: true }]));
    renderSection();

    const invites = await screen.findByTestId("invites-section");
    const members = await screen.findByTestId("members-section");
    expect(invites.compareDocumentPosition(members) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the selected invite role consequences before creating the link", async () => {
    vi.stubGlobal("fetch", mockApi([{ userId: "me", role: "owner", isSelf: true }]));
    await renderInviteSection();
    await screen.findByTestId("members-section");

    expect(screen.getByTestId("invite-role-summary")).toHaveTextContent(/Can edit scheduling data/);
    fireEvent.keyDown(screen.getByTestId("invite-role"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Viewer" }));
    expect(screen.getByTestId("invite-role-summary")).toHaveTextContent(/Read-only schedule access/);
  });
}

function registerInviteDeadlineTests(): void {
  it("renders outstanding invite expiry on the viewer local calendar date", async () => {
    const expiresAt = "2026-12-01T00:00:00.000Z";
    const localDate = vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue("LOCAL INVITE DATE");
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "GET /invites": () =>
        jsonResponse({
          invites: [
            {
              id: 1,
              role: "viewer",
              preauthEmail: "existing@example.test",
              expiresAt,
              createdAt: "2026-07-17T00:00:00.000Z",
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderInviteSection();

    expect(await screen.findByText(/expires LOCAL INVITE DATE/)).toBeInTheDocument();
    expect(localDate).toHaveBeenCalled();
    expect(localDate.mock.contexts.every((date) => (date as Date).toISOString() === expiresAt)).toBe(true);
  });

  it("marks an invitation expired and removes its action without remounting Settings", async () => {
    const expiryDelay = 60_000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const expiresAt = new Date(Date.now() + expiryDelay).toISOString();
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "GET /invites": () =>
        jsonResponse({
          invites: [
            {
              id: 2,
              role: "viewer",
              preauthEmail: "expiring@example.test",
              expiresAt,
              createdAt: "2026-07-17T00:00:00.000Z",
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByTestId("invite-open"));
    expect(screen.getByTestId("invite-revoke")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(expiryDelay + 1);
    });
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    expect(screen.queryByTestId("invite-revoke")).not.toBeInTheDocument();
  });
}

function registerInviteReloadTests(): void {
  it("keeps the last authoritative invite list when a same-account invite reload fails", async () => {
    const existingInvite = {
      id: 1,
      role: "viewer",
      preauthEmail: "existing@example.test",
      expiresAt: "2026-12-01T00:00:00.000Z",
      createdAt: "2026-07-17T00:00:00.000Z",
    };
    let invitationReads = 0;
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "GET /invites": () => {
        invitationReads += 1;
        return invitationReads === 1
          ? jsonResponse({ invites: [existingInvite] })
          : jsonResponse({ error: "Invite reload failed." }, 503);
      },
      "POST /api/invites": () => jsonResponse({ id: 3, emailed: true }, 201),
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderInviteSection();
    expect(await screen.findByText(/existing@example\.test/)).toBeInTheDocument();

    fillAddressedInvite();
    fireEvent.click(screen.getByTestId("invite-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invite reload failed.");
    expect(screen.getByText(/existing@example\.test/)).toBeInTheDocument();
  });
}

function registerInviteMutationTransitionTests(): void {
  it("ignores a late unknown mutation outcome after the user has switched accounts", async () => {
    const nextAccountId = "acc_second";
    let resolveCreate: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      const target = String(url);
      const isRead = !init || init.method === undefined || init.method === "GET";
      if (target.endsWith("/members") && isRead) {
        const second = target.includes(`/${nextAccountId}/`);
        return jsonResponse({
          members: [
            second
              ? rawMember({ userId: "second-owner", role: "owner", email: "second@example.test", isSelf: true })
              : rawMember({ userId: "me", role: "owner", isSelf: true }),
          ],
        });
      }
      if (target.endsWith("/invites") && isRead) {
        return jsonResponse({ invites: [] });
      }
      if (target.endsWith("/api/invites") && init?.method === "POST") {
        return await new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        });
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderInviteSection();
    await screen.findByTestId("members-section");

    fillAddressedInvite();
    fireEvent.click(screen.getByTestId("invite-submit"));
    await waitFor(() => expect(resolveCreate).toBeTypeOf("function"));
    act(() => useStore.setState({ activeAccountId: nextAccountId }));
    expect(await screen.findByText("second@example.test")).toBeInTheDocument();

    await act(async () => {
      resolveCreate?.(jsonResponse({ error: "The first account outcome is unknown." }, 503));
    });

    expect(screen.getByText("second@example.test")).toBeInTheDocument();
    expect(screen.queryByText(/first account outcome is unknown/i)).not.toBeInTheDocument();
    expect(useStore.getState().notice?.message ?? "").not.toMatch(/unknown outcome/i);
  });
}

function registerInviteValidationTests(): void {
  it.each([
    [201, true, "Invitation emailed to diana@example.test"],
    [202, false, "The invitation was saved, but the email could not be sent. Use Resend to try again."],
  ])("emails a new invitation and reports a %s delivery", async (status, emailed, notice) => {
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "POST /api/invites": () => jsonResponse(emailed ? { id: 1, emailed } : { committed: true, emailed }, status),
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderInviteSection();
    await screen.findByTestId("members-section");

    fillAddressedInvite();
    fireEvent.click(screen.getByTestId("invite-submit"));

    await expectNotice(new RegExp(notice.replace(/[.]/g, "\\.")));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      accountId: DEFAULT_ACCOUNT_ID,
      role: "editor",
      email: "diana@example.test",
    });
  });

  it.each(["password-only"] as const)("requires an email for a %s invite without posting", async (authMode) => {
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }]);
    vi.stubGlobal("fetch", fetchMock);
    renderSection({ authMode });
    await screen.findByTestId("invite-open");
    fireEvent.click(screen.getByTestId("invite-open"));

    await userEvent.setup().click(await screen.findByTestId("invite-submit"));

    const field = screen.getByTestId("invite-preauth");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(m.settings_invite_email_required());
    expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
}

function registerInviteCreationFailureTests(): void {
  it.each([
    { status: 503, body: { error: "Invite uncertain." }, expected: /unknown outcome.*reloaded/i, fieldError: false },
    { status: 403, body: { error: "Invite forbidden." }, expected: /Invite forbidden\./, fieldError: true },
  ])(
    "handles a $status invite-create response on the current account",
    async ({ status, body, expected, fieldError }: InviteFailureCaseInput) => {
      vi.stubGlobal(
        "fetch",
        mockApi(ownerAndEditor, {
          "POST /api/invites": () => jsonResponse(body, status),
        }),
      );
      await renderInviteSection();

      fillAddressedInvite();
      await userEvent.setup().click(await screen.findByTestId("invite-submit"));

      const alert = fieldError ? await screen.findByRole("alert") : null;
      if (fieldError) expect(alert).toHaveTextContent(expected);
      else await expectNotice(expected);
      if (fieldError) {
        if (alert === null) throw new Error("Expected the invitation field error");
        expect(screen.getByTestId("invite-preauth").getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
      }
    },
  );

  it("reconciles a thrown invite creation", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi([{ userId: "me", role: "owner", isSelf: true }], {
        "POST /api/invites": () => Promise.reject(new Error("invite transport lost")),
      }),
    );
    await renderInviteSection();

    fillAddressedInvite();
    await userEvent.setup().click(await screen.findByTestId("invite-submit"));

    await expectNotice(/unknown outcome.*invite transport lost.*reloaded/i);
  });
}

function registerInviteRevokeFailureTests(): void {
  it.each([
    { status: 503, body: { error: "Revoke uncertain." }, expected: /unknown outcome.*reloaded/i, reconciles: true },
    { status: 403, body: { error: "Revoke forbidden." }, expected: /Revoke forbidden\./, reconciles: false },
  ])(
    "handles a $status invite-revoke response without dropping the row",
    async ({ status, body, expected, reconciles }: InviteReconciliationCaseInput) => {
      let inviteReads = 0;
      const invite = {
        id: 1,
        role: "editor",
        preauthEmail: "existing@example.test",
        expiresAt: "2026-12-01T00:00:00.000Z",
        createdAt: "2026-07-17T00:00:00.000Z",
      };
      vi.stubGlobal(
        "fetch",
        mockApi([{ userId: "me", role: "owner", isSelf: true }], {
          "GET /invites": () => {
            inviteReads += 1;
            return jsonResponse({ invites: [invite] });
          },
          "DELETE /invites/1": () => jsonResponse(body, status),
        }),
      );
      await renderInviteSection();
      closeInviteDialog();

      await userEvent.setup().click(await screen.findByTestId("invite-revoke"));

      if (reconciles) await expectNotice(expected);
      else expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(screen.getByText(/existing@example\.test/)).toBeInTheDocument();
      expect(inviteReads).toBe(reconciles ? 2 : 1);
    },
  );

  it("warns and rereads invitations after a thrown revoke", async () => {
    let inviteReads = 0;
    const invite = {
      id: 1,
      role: "editor",
      preauthEmail: "existing@example.test",
      expiresAt: "2026-12-01T00:00:00.000Z",
      usedAt: null,
      createdAt: "2026-07-17T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      mockApi([{ userId: "me", role: "owner", isSelf: true }], {
        "GET /invites": () => {
          inviteReads += 1;
          return jsonResponse({ invites: [invite] });
        },
        "DELETE /invites/1": () => Promise.reject(new Error("revoke transport lost")),
      }),
    );
    await renderInviteSection();

    closeInviteDialog();
    await userEvent.setup().click(await screen.findByTestId("invite-revoke"));

    await expectNotice(/unknown outcome.*revoke transport lost.*reloaded/i);
    expect(inviteReads).toBe(2);
  });
}
