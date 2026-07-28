import { describe, expect, it } from "vitest";
import { MAX_PASSWORD_LENGTH } from "../domain/password";
import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH } from "../lib/strings";
import {
  MAX_ACCOUNT_PASSWORD_CONTEXT_WORDS,
  boundApplicationFailure,
  isAccountEmail,
  normalizeAccountEmail,
  validateCredentialInput,
} from "./validation";

const validApplication = {
  applicationId: "sibling_app",
  displayName: "Sibling App",
  branding: {
    totpIssuer: "Sibling App",
    defaultProviderLabel: "Single sign-on",
    passwordContextWords: ["sibling", "product"],
  },
};

describe("boundApplicationFailure", () => {
  it.each([[null], ["application"], [[]]])("rejects a non-object application binding: %j", (application) => {
    expect(boundApplicationFailure(application)).toBe("The account application binding must be an object.");
  });

  it("accepts a complete provider-neutral application binding", () => {
    expect(boundApplicationFailure(validApplication)).toBeNull();
  });

  it("accepts an application id at the 64-character boundary", () => {
    expect(
      boundApplicationFailure({
        ...validApplication,
        applicationId: "a".repeat(64),
      }),
    ).toBeNull();
  });

  it("accepts branding values at their configured boundaries", () => {
    expect(
      boundApplicationFailure({
        ...validApplication,
        displayName: "a".repeat(MAX_NAME_LENGTH),
        branding: {
          totpIssuer: "a".repeat(MAX_NAME_LENGTH),
          defaultProviderLabel: "a".repeat(MAX_NAME_LENGTH),
          passwordContextWords: Array.from({ length: MAX_ACCOUNT_PASSWORD_CONTEXT_WORDS }, () =>
            "a".repeat(MAX_PASSWORD_LENGTH),
          ),
        },
      }),
    ).toBeNull();
  });

  it("counts astral CJK branding and credential names as Unicode code points", () => {
    const astralLetter = "𠀀";
    expect(astralLetter).toHaveLength(2);
    expect(
      boundApplicationFailure({
        ...validApplication,
        displayName: astralLetter.repeat(MAX_NAME_LENGTH),
        branding: {
          ...validApplication.branding,
          totpIssuer: astralLetter.repeat(MAX_NAME_LENGTH),
          defaultProviderLabel: astralLetter.repeat(MAX_NAME_LENGTH),
        },
      }),
    ).toBeNull();
    expect(
      validateCredentialInput({
        email: "person@example.com",
        displayName: astralLetter.repeat(MAX_NAME_LENGTH),
        password: "a-valid-length-password",
      }),
    ).toBeNull();
    expect(
      validateCredentialInput({
        email: "person@example.com",
        displayName: astralLetter.repeat(MAX_NAME_LENGTH + 1),
        password: "a-valid-length-password",
      }),
    ).toBe("display-name");
  });

  it.each([
    [{ ...validApplication, displayName: "a".repeat(MAX_NAME_LENGTH + 1) }, "display name"],
    [
      {
        ...validApplication,
        branding: {
          ...validApplication.branding,
          totpIssuer: "a".repeat(MAX_NAME_LENGTH + 1),
        },
      },
      "branding",
    ],
    [
      {
        ...validApplication,
        branding: {
          ...validApplication.branding,
          defaultProviderLabel: "a".repeat(MAX_NAME_LENGTH + 1),
        },
      },
      "branding",
    ],
    [
      {
        ...validApplication,
        branding: {
          ...validApplication.branding,
          passwordContextWords: ["a".repeat(MAX_PASSWORD_LENGTH + 1)],
        },
      },
      "branding",
    ],
    [
      {
        ...validApplication,
        branding: {
          ...validApplication.branding,
          passwordContextWords: Array.from({ length: MAX_ACCOUNT_PASSWORD_CONTEXT_WORDS + 1 }, () => "word"),
        },
      },
      "branding",
    ],
  ])("rejects an application binding beyond a branding bound %#", (application, message) => {
    expect(boundApplicationFailure(application)).toContain(message);
  });

  it.each([
    [{ ...validApplication, applicationId: "../other" }, "application id"],
    [{ ...validApplication, applicationId: "a".repeat(65) }, "application id"],
    [{ ...validApplication, applicationId: "Uppercase" }, "application id"],
    [{ ...validApplication, applicationId: "-prefixed" }, "application id"],
    [{ ...validApplication, applicationId: "_prefixed" }, "application id"],
    [{ ...validApplication, displayName: "   " }, "display name"],
    [
      {
        ...validApplication,
        branding: { ...validApplication.branding, totpIssuer: "" },
      },
      "branding",
    ],
    [
      {
        ...validApplication,
        branding: { ...validApplication.branding, defaultProviderLabel: " " },
      },
      "branding",
    ],
    [
      {
        ...validApplication,
        branding: { ...validApplication.branding, passwordContextWords: [] },
      },
      "branding",
    ],
    [
      {
        ...validApplication,
        branding: { ...validApplication.branding, passwordContextWords: [""] },
      },
      "branding",
    ],
  ])("rejects invalid binding %#", (application, message) => {
    expect(boundApplicationFailure(application)).toContain(message);
  });
});

describe("identity input validation", () => {
  it.each([
    [" Person@Example.COM ", "person@example.com"],
    ["ALICE@EXAMPLE.COM", "alice@example.com"],
  ])("normalizes account email %j", (input, expected) => {
    expect(normalizeAccountEmail(input)).toBe(expected);
  });

  it.each([
    ["Person@Example.COM", true],
    ["", false],
    [" person@example.com", false],
    ["person@example.com ", false],
    ["person.example.com", false],
    ["person@", false],
    ["person@@example.com", false],
    ["person name@example.com", false],
  ])("classifies basic email shape %j", (email, expected) => {
    expect(isAccountEmail(email)).toBe(expected);
  });

  it.each([
    [
      {
        email: "Person@example.com",
        displayName: "Person",
        password: "a-valid-length-password",
      },
      "email",
    ],
    [
      {
        email: "person@example.com",
        displayName: " Person ",
        password: "a-valid-length-password",
      },
      "display-name",
    ],
    [{ email: "person@example.com", displayName: "Person", password: "short" }, "password-length"],
    [
      {
        email: "person@example.com",
        displayName: "Person",
        password: "a-valid-length-password",
      },
      null,
    ],
  ] as const)("classifies credential input %#", (input, expected) => {
    expect(validateCredentialInput(input)).toBe(expected);
  });

  it.each([
    "invite\0@example.com",
    "invite\u202e@example.com",
    "invite\u200b@example.com",
    "invite\ud800@example.com",
    "invite\ue000@example.com",
    "invite\u0378@example.com",
  ])("rejects disallowed email code points in %j", (email) => {
    expect(isAccountEmail(email)).toBe(false);
  });

  it("accepts the exact email limit and rejects the next code unit", () => {
    expect(isAccountEmail(`${"a".repeat(MAX_EMAIL_LENGTH - 4)}@x.y`)).toBe(true);
    expect(isAccountEmail(`${"a".repeat(MAX_EMAIL_LENGTH - 3)}@x.y`)).toBe(false);
  });

  it("applies the email limit to UTF-8 bytes", () => {
    expect(isAccountEmail(`${"é".repeat(125)}@x.y`)).toBe(true);
    expect(isAccountEmail(`${"é".repeat(126)}@x.y`)).toBe(false);
  });

  it("rejects an in-limit address whose normalized form expands beyond the limit", () => {
    const email = `${"İ".repeat(MAX_EMAIL_LENGTH - 2)}@a`;
    expect(email).toHaveLength(MAX_EMAIL_LENGTH);
    expect(normalizeAccountEmail(email).length).toBeGreaterThan(MAX_EMAIL_LENGTH);
    expect(isAccountEmail(email)).toBe(false);
  });

  it.each(["Person\0Name", "Person\u202eName", "Person\u200bName"])(
    "rejects a disallowed credential display name in %j",
    (displayName) => {
      expect(
        validateCredentialInput({
          email: "person@example.com",
          displayName,
          password: "a-valid-length-password",
        }),
      ).toBe("display-name");
    },
  );

  it("accepts the exact display-name limit and rejects the next code unit", () => {
    expect(
      validateCredentialInput({
        email: "person@example.com",
        displayName: "a".repeat(MAX_NAME_LENGTH),
        password: "a-valid-length-password",
      }),
    ).toBeNull();
    expect(
      validateCredentialInput({
        email: "person@example.com",
        displayName: "a".repeat(MAX_NAME_LENGTH + 1),
        password: "a-valid-length-password",
      }),
    ).toBe("display-name");
  });
});
