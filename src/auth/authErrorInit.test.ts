// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("public/auth-error-init.js", "utf8");

function runAt(href: string) {
  const replaceState = vi.fn();
  const window = {
    location: { href },
    history: { state: { retained: true }, replaceState },
  };
  runInNewContext(source, { URL, window });
  return replaceState;
}

describe("pre-hydration external sign-in error cleanup", () => {
  it("removes provider-controlled fields while retaining the safe product marker", () => {
    const replaceState = runAt(
      "https://app.example/invite/token?externalSignInError=1&error=access_denied" +
        "&error_description=tenant%20policy&error_uri=https%3A%2F%2Fidp.example%2Fdetail&keep=1",
    );

    expect(replaceState).toHaveBeenCalledWith(
      { retained: true },
      "",
      "https://app.example/invite/token?externalSignInError=1&keep=1",
    );
  });

  it.each(["OIDC_IDENTITY_VERIFICATION_FAILED", "account_already_linked_to_different_user", "account_link_conflict"])(
    "retains the allowlisted application error code %s",
    (code) => {
      const replaceState = runAt(
        `https://app.example/?externalSignInError=1&error=${code}&error_description=untrusted`,
      );

      expect(replaceState).toHaveBeenCalledWith(
        { retained: true },
        "",
        `https://app.example/?externalSignInError=1&error=${code}`,
      );
    },
  );

  it("does not rewrite an unmarked application query", () => {
    expect(runAt("https://app.example/?error=ordinary-product-value")).not.toHaveBeenCalled();
  });

  it("removes every provider diagnostic from a link-failure return while preserving its marker", () => {
    const replaceState = runAt(
      "https://app.example/settings?capacitylensSsoLinkFailed=ceremony-1&error=access_denied" +
        "&error_description=tenant%20policy&error_uri=https%3A%2F%2Fidp.example%2Fdetail&keep=1",
    );

    expect(replaceState).toHaveBeenCalledWith(
      { retained: true },
      "",
      "https://app.example/settings?capacitylensSsoLinkFailed=ceremony-1&keep=1",
    );
  });

  it("removes standalone provider detail fields from a marked link failure", () => {
    const replaceState = runAt(
      "https://app.example/settings?capacitylensSsoLinkFailed=ceremony-1" +
        "&error_description=tenant%20policy&error_uri=https%3A%2F%2Fidp.example%2Fdetail&keep=1",
    );

    expect(replaceState).toHaveBeenCalledWith(
      { retained: true },
      "",
      "https://app.example/settings?capacitylensSsoLinkFailed=ceremony-1&keep=1",
    );
  });
});
