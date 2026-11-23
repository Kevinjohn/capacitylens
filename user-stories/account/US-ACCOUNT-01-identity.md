# US-ACCOUNT-01 — Check my signed-in identity

As a signed-in person, I want to check which identity I am using so that I can confirm the account behind my company access.

**Status:** Current
**Access:** Any signed-in person.
**Entry:** Account
**Documentation:** [Account](../../docs-src/using/account.md)
**Source:** [AccountView.tsx](../../apps/frontend/src/components/account/AccountView.tsx); [en.json](../../apps/frontend/messages/en.json)

## Acceptance criteria

- Account shows the identity's avatar, name and email in the identity table. A shortened email can be hovered or focused to read it in full; narrow screens can scroll the row sideways.
- The row offers **Change password**, **Delete account** and **Sign out**.

## User flow

```mermaid
flowchart TD
  open["Open Account"] --> details["See the signed-in name, email and avatar"]
  details --> check["Confirm which identity is active for this company"]
```

## Code flow

```mermaid
flowchart TD
  start["AuthProvider calls fetchAuthStatus"] --> status["Read View as member status"]
  status -->|Active| actor["Adopt the target grant and use the real actor as user"]
  status -->|Inactive| me["sessionRequests.me and readAuthResponse verify the ordinary identity"]
  status -->|Unverifiable| error["Auth checks keep Account closed"]
  actor --> context["useAuthContextValue supplies the verified user"]
  me -->|Pass| context
  me -->|Signed out| signIn["Render sign-in"]
  me -->|Failed| error
  context --> gates{"AuthProvider allows the router?"}
  gates -->|Email, admission, membership or setup gate| limited["Account stays closed; AccessScreen can show the email and Sign out"]
  gates -->|Yes| account["AccountView renders the user’s name, avatar, email and identity actions"]
```

**Code references:** [fetchAuthStatus.ts](../../apps/frontend/src/auth/fetchAuthStatus.ts#L31) · [fetchAuthStatus.ts](../../apps/frontend/src/auth/fetchAuthStatus.ts#L67) · [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx#L257) · [AccountView.tsx](../../apps/frontend/src/components/account/AccountView.tsx#L72) · [AccessScreens.tsx](../../apps/frontend/src/auth/AccessScreens.tsx#L25)
