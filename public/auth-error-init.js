// Remove identity-provider diagnostics before the application bundle loads. Keep only the
// CapacityLens marker and allowlisted application-owned error codes so the mounted auth surface
// can render its stable message and remove both. This external script remains usable under the
// production no-inline-script CSP.
(function clearProviderErrorDetail() {
  var url = new URL(window.location.href);
  var externalSignInFailure = url.searchParams.get("externalSignInError") === "1";
  var providerLinkFailure = url.searchParams.has("capacitylensSsoLinkFailed");
  if (!externalSignInFailure && !providerLinkFailure) return;
  var error = url.searchParams.get("error");
  if (
    providerLinkFailure ||
    (error !== "OIDC_IDENTITY_VERIFICATION_FAILED" &&
      error !== "account_already_linked_to_different_user" &&
      error !== "account_link_conflict")
  ) {
    url.searchParams.delete("error");
  }
  url.searchParams.delete("error_description");
  url.searchParams.delete("error_uri");
  window.history.replaceState(window.history.state, "", url.toString());
})();
