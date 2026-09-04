import { useParams } from "react-router-dom";
import { InviteAcceptView } from "./InviteAcceptView";
import { useInviteAcceptController } from "./useInviteAcceptController";

// Invite accept page for /invite/:token. On mount, in SERVER mode, it previews the invite.
// A signed-in person must then explicitly accept before the single-use POST is sent. The server is
// the authority: a valid link binds the invited role to the signed-in caller's membership; a
// used/expired/unknown link is refused. This page never re-implements that policy client-side.
//
// PRE-SESSION ONBOARDING: this route sits inside AuthProvider but outside AppShell's tenant gate.
// Password mode deliberately carves it out of the login wall so a genuinely new invitee can create
// a credential through the token-scoped signup endpoint; an existing user can sign in here and the
// page reloads the same token URL so they can review and explicitly accept as that identity.

/**
 * Invite-accept page for `/invite/:token`.
 *
 * In server mode it previews the invite, asks a signed-in person to accept explicitly, then renders
 * a "you've joined" success (with a continue link after switching to the joined company), the
 * matching endpoint error, or a generic failure. In the demo build there is no server to accept
 * against, so it shows a short "invites require server mode" note and makes no request.
 */
export function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  // React Router may preserve the route element while only changing `:token`. Key the stateful
  // implementation so preview data and command identities can never cross invitation URLs.
  return <InviteAcceptForToken key={token ?? ""} token={token} />;
}

function InviteAcceptForToken({ token }: { token: string | undefined }) {
  const flow = useInviteAcceptController(token);
  return <InviteAcceptView {...flow} />;
}
