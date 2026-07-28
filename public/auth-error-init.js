// Remove identity-provider diagnostics before the application bundle loads. Keep only the
// CapacityLens marker so the mounted auth surface can render its stable message and remove that
// marker too. This external script remains usable under the production no-inline-script CSP.
(function clearProviderErrorDetail() {
  var url = new URL(window.location.href);
  if (url.searchParams.get("externalSignInError") !== "1" || !url.searchParams.has("error")) return;
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  url.searchParams.delete("error_uri");
  window.history.replaceState(window.history.state, "", url.toString());
})();
