import { useParams } from "react-router-dom";
import { InviteAcceptView } from "./InviteAcceptView";
import { useInviteAcceptController } from "./useInviteAcceptController";

// The invitation route renders before company selection so an invitee can authenticate without passing the tenant gate. Membership is granted only by the server, and an existing signed-in user must confirm acceptance.

/** Previews an invitation, requests explicit acceptance, and shows the confirmed membership outcome. Demo mode has no invitation endpoint. */
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
