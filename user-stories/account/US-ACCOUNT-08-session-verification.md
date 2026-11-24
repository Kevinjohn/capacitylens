# US-ACCOUNT-08 — Retry session verification

As a person whose session could not be checked, I want to retry verification so that I can continue when the service is available.

**Status:** Current
**Access:** Person whose session verification failed.
**Entry:** Session verification error → Try again
**Documentation:** [Sign-in and access](../../docs-src/sign-in/index.md)
**Source:** [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx); [en.json](../../apps/frontend/messages/en.json)

## Acceptance criteria

- The error screen says **Unable to verify your session**, shows the failure message and offers **Try again**.
- **Try again** checks the session again. If verification still fails, the error remains visible; a successful check continues through the appropriate signed-in or sign-in screen.

## User flow

```mermaid
flowchart TD
  error["Session verification error"] --> retry["Read message → Try again"]
  retry --> accepted["Session accepted: continue into the app"]
  retry --> rejected["Session rejected: go to sign in"]
  retry --> unavailable["Service unavailable: error remains with Try again"]
```

## Code flow

```mermaid
flowchart TD
  retry["AuthError Try again calls AuthProvider checkAuth"] --> status["fetchAuthStatus checks masqueradeApi.status first"]
  status --> controller["MasqueradeController.show uses getSignedInSession to verify the real sign-in"]
  controller -->|Session verified| mode["readCurrentMasquerade checks View as member status"]
  mode -->|Active| projected["Validate the actor and adopt the read-only projection"]
  mode -->|Inactive| me["Adopt inactive status and read sessionRequests.me"]
  controller -->|No valid sign-in| me
  status -->|Transport failure| fallback["Probe sessionRequests.me while projection is unknown"]
  status -->|Other failure| error["Render AuthError and retain Try again"]
  fallback -->|401| signIn["Show the sign-in screen"]
  fallback -->|Success or another failure| error
  me --> session["SessionController.show rechecks the sign-in under limited withActor"]
  session --> answers["readAuthResponse interprets the server response"]
  answers -->|401| signIn
  me -->|Request failed| error
  answers -->|Failed or malformed| error
  answers -->|Pass| gates["AuthProvider renders the applicable account or setup gate, or opens the router"]
  projected -->|Adopted| gates
  projected -->|Failed| error
```

See [Signed-in requests](../REFERENCE.md#signed-in-requests) for the raw guard, effective guard and transaction checks.

**Code references:** [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx#L172) · [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx#L238) · [fetchAuthStatus.ts](../../apps/frontend/src/auth/fetchAuthStatus.ts#L11) · [fetchAuthStatus.ts](../../apps/frontend/src/auth/fetchAuthStatus.ts#L67) · [masquerade_controller.ts](../../apps/backend/app/controllers/masquerade_controller.ts#L49) · [current_actor.ts](../../apps/backend/app/services/auth/current_actor.ts#L123) · [masquerade.ts](../../apps/backend/app/services/auth/masquerade.ts#L38) · [session_controller.ts](../../apps/backend/app/controllers/session_controller.ts#L33) · [authResponse.ts](../../apps/frontend/src/auth/authResponse.ts#L120)
