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
  entry["SignInScreen renders SignInForm"] --> validate["usePasswordSignIn normalizes email and checks input"]
  validate -->|Invalid| refusal["Show validation or server refusal and allow retry"]
  validate -->|Valid| api["authApi.signIn.email sends credentials"]
  api --> controller["SessionController.store validates request and calls signInWithPassword"]
  controller --> kit["signInWithPassword calls Account Kit login through the raw web guard adapter"]
  kit -->|Sign-in registered| session["Use limited withActor to verify it, record member sign-in for active memberships with tracking enabled, and build the user response"]
  kit -->|Invalid credentials, throttled or otherwise refused| refusal
  api -->|Transport failure| network["Show network error and allow retry"]
  session -->|Success| reload["onSignedIn fully reloads the page"]
  session -->|Follow-up fails| followUp["Show the error even though Account Kit already registered the sign-in"]
  reload --> status["AuthProvider fetchAuthStatus rechecks the server session"]
  status -->|Unconfirmed address, admission or membership| limited["Render first applicable AccessScreen"]
  status -->|First company required| setup["Render CompanySetup"]
  status -->|Pass| app["Open the router and AppShell"]
  status -->|Signed out or check failed| retry["Render sign-in or retryable AuthError"]
```

See [Signed-in requests](../REFERENCE.md#signed-in-requests) for the raw guard and transaction checks and [Sign out of this browser](../account/US-ACCOUNT-04-sign-out.md#code-flow) for sign-out.

**Code references:** [SignInForm.tsx](../../apps/frontend/src/auth/SignInForm.tsx#L46) · [usePasswordSignIn.ts](../../apps/frontend/src/auth/usePasswordSignIn.ts#L9) · [session_controller.ts](../../apps/backend/app/controllers/session_controller.ts#L77) · [password_sign_in_service.ts](../../apps/backend/app/services/auth/password_sign_in_service.ts#L49) · [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx#L152) · [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx#L250) · [password_sessions.spec.ts](../../apps/backend/tests/functional/auth/password_sessions.spec.ts#L118)
