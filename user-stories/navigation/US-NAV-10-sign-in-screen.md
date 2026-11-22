# US-NAV-10 — Enter the persisted application

As an invited company member, I want to sign in before accessing persisted company data so that my session is authenticated.

**Status:** Current

**Access:** Unauthenticated visitors; admitted users can sign in

**Entry:** Sign-in screen; Account → Sign out

**Documentation:** [Account](../../docs-src/using/account.md)

**Source:** [SignInScreen.tsx](../../apps/frontend/src/auth/SignInScreen.tsx); [AccountView.tsx](../../apps/frontend/src/components/account/AccountView.tsx)

## Acceptance criteria

| Field    | Control        | Required/default/conditions                                                                                        |
| -------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Email    | Email input    | Submitted for password sign-in; browser email autofill enabled                                                     |
| Password | Password input | Submitted for password sign-in; current-password autofill; overlong input is rejected and associated with an error |

- Sign in submits credentials; Account → Sign out ends the session and returns to sign-in. The disposable demo uses its printed development sign-in.

## User flow

```mermaid
flowchart TD
  enter["Enter email and password"] --> submit["Submit sign-in"]
  submit -->|accepted| app["Persisted app opens"]
  submit -->|rejected| error["Sign-in error remains visible"]
  app --> account["Open Account and choose Sign out"]
  account --> signin["Sign-in screen returns"]
```

## Code flow

```mermaid
flowchart TD
  screen["SignInScreen renders SignInForm"] --> hook["usePasswordSignIn submits credentials"]
  hook --> auth["authApi password sign-in request"]
  auth --> session["AuthProvider refreshes signed-in status"]
  session --> app["AppShell becomes available"]
  account["AccountView sign out"] --> signedOut["signOutAndReload ends session and reloads"]
```

**Code references:** [usePasswordSignIn.ts](../../apps/frontend/src/auth/usePasswordSignIn.ts); [SignInScreen.tsx](../../apps/frontend/src/auth/SignInScreen.tsx); [SignInForm.tsx](../../apps/frontend/src/auth/SignInForm.tsx); [authApi.ts](../../apps/frontend/src/auth/authApi.ts); [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx); [AccountView.tsx](../../apps/frontend/src/components/account/AccountView.tsx); [signOut.ts](../../apps/frontend/src/auth/signOut.ts)
