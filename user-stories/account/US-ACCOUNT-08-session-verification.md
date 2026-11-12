# US-ACCOUNT-08 — Retry session verification

As a person whose session could not be checked, I want to retry verification so that I can continue when the service is available.

**Status:** Current
**Access:** Person whose session verification failed.
**Entry:** Session verification error → Try again
**Documentation:** [Sign-in and access](../../docs-src/company-login/index.md)
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
  error["AuthProvider renders AuthError for failed check"] --> retry["AuthError retry sets checking and calls checkAuth"]
  retry --> fetch["checkAuth runs fetchAuthStatus"]
  fetch --> me["fetchAuthStatus reads accountClient.me"]
  me --> status["AuthProvider renders pass, login or retryable error state"]
```

**Code references:** [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx), [fetchAuthStatus.ts](../../apps/frontend/src/auth/fetchAuthStatus.ts), [accountClient.ts](../../apps/frontend/src/account/accountClient.ts)
