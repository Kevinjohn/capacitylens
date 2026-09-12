# US-SET-18 — Hand the company to someone else (ownership transfer ceremony)

**Area:** Team & access · **Persona:** Studio owner handing over + the Admin taking over ·
**Linked E2E:** `e2e/ownership-transfer.auth.spec.ts` → "an owner nominates an admin, the admin
agrees, the owner confirms, and the two roles swap"

## Goal

Let an Owner hand their company to an Admin who has agreed to take it, in three deliberate steps —
the Owner nominates, the nominated Admin agrees, the same Owner confirms — with either side able to
stop it at any point before the last step, and with both sides able to see what happened to a
request that ended while they were away.

**Guide:** [Roles and permissions → Hand the company to someone
else](../../docs-src/getting-started/roles-and-permissions.md#hand-the-company-to-someone-else)

## Why

Ownership is the only role that can delete the company or replace its whole dataset, so handing it
over is the most consequential thing anybody does in Team & access — and the person receiving it
takes on that exposure. A single call that promotes someone the moment the Owner clicks is a
one-sided decision about somebody else's responsibility: the recipient learns they now own a company
by discovering that they do. It is also unrecoverable by the person who gave it away, because the
step down to Admin removes the authority needed to take it back.

Three deliberate acts by two people fix both. The nominee's agreement is theirs alone to give — no
other Admin, and not the Owner who asked, can give it for them — and the Owner's second act is a
confirmation made with the answer in hand rather than a click made in hope. Because the ceremony
spans sessions and days, the request is durable, it expires on its own, and it ends by itself when
the people it names stop being the right people: consent given for one arrangement never survives
into a different one.

## How (end-to-end)

**Precondition:** Server mode with authentication on. Owner A (Bruce Wayne) and active Admin B
(Selina Kyle) are members of the same company. Both have a recent sign-in confirmation, as with
every sensitive action.

1. As **A**, open **Team & access**. Below member management sits **Company ownership**
   (`data-testid="ownership-transfer-card"`), explaining that ownership moves in three steps and
   that nothing changes until all three have happened.
2. A picks B from **Next Owner** (`data-testid="ownership-transfer-nominee"`) and chooses **Start
   transfer** (`data-testid="ownership-transfer-start"`). Only **active Admins** are offered.
3. The card now shows the live request (`data-testid="ownership-transfer-state"`): waiting for B to
   agree, and the date the request expires. A keeps **Cancel the transfer**
   (`data-testid="ownership-transfer-cancel"`) and can nominate somebody else instead
   (`data-testid="ownership-transfer-replace"`), which replaces the standing request rather than
   opening a second one. **Confirm the transfer** is not offered yet.
4. As **B**, the same card offers **Agree to become Owner**
   (`data-testid="ownership-transfer-accept"`) and **Decline**
   (`data-testid="ownership-transfer-decline"`) — and none of A's controls.
5. B agrees. B's side now offers only **Withdraw my agreement**
   (`data-testid="ownership-transfer-withdraw"`); A's side gains **Confirm the transfer**
   (`data-testid="ownership-transfer-complete"`).
6. A confirms. B becomes the **Owner** and A becomes an **Admin** in one server call; the member
   list, A's own role badge and A's affordances all reflect the demotion immediately.
7. Anyone who is neither participant sees no card at all, at any point.

## Acceptance criteria

- Ownership moves only through this ceremony. It is never granted by an invite, a role change or
  any single call, and the company always has exactly one Owner — including at every intermediate
  step, because completion demotes before it promotes.
- Each step has exactly one authorised person, by identity and not by tier:
  - **nominate**, **cancel** and **confirm** belong to the Owner who started the request;
  - **agree**, **withdraw** and **decline** belong to the nominated Admin and to nobody else. No
    other Admin can agree on their behalf, and neither can the Owner who asked — that consent is
    the point of the ceremony.
- Only an **active Admin** of the same company may be nominated. A self-nomination, a non-member, a
  member of another company and a member in any other role are all refused.
- A request expires **seven days** after it was made, whether or not the nominee has agreed;
  agreeing does not extend it. Past that deadline both participants are told the request expired
  rather than being offered controls that can only fail, and the next nomination commits the expiry
  instead of being blocked by it.
- A request ends by itself when the people it names stop being the right people: the nominee ceasing
  to be an active Admin, the initiator ceasing to be the Owner, a role change, a status change or a
  removal touching either participant. The request ends; the company keeps the Owner it had.
- Both participants — and nobody else — can read the request. A viewer who is not a participant
  reads an empty projection, so hiding the card is presentation, never the authorisation mechanism.
- A participant who was away when a request ended sees **how** it ended (declined, cancelled,
  replaced, expired, or ended because the people changed) rather than an empty card.
- Every step requires a fresh administrative assurance; **seeing** the request does not, so a
  participant who signed in hours ago can still read the nomination they are being asked to approve.
  Neither reading nor acting is available while viewing the company as somebody else (masquerade).
- A step submitted against a request that has since moved is refused rather than applied: each
  command carries the workflow revision it was authorised against.
- API routes: `GET /api/accounts/:accountId/ownership-transfer` (both participants; `{live,
latestOutcome}`, each nullable), `POST …/ownership-transfer {toUserId, expectedRequestId?,
expectedRevision?}` (**201**; naming the standing request is what makes replacement atomic — both
  fields or neither),
  `POST …/ownership-transfer/:requestId/accept|withdraw|decline|complete`, and
  `DELETE …/ownership-transfer/:requestId` (cancel). A request the server has already ended answers
  **409** with `code: "OWNERSHIP_TRANSFER_TERMINAL"` plus the state and reason — a committed
  outcome the interface explains, not an error the user can act on.
