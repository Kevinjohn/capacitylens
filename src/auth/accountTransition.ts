/** The authenticated account-switch boundary. It ends any current read projection before the
 * persistence subscriber installs another account's slice. */
export async function transitionAccount(accountId: string | null): Promise<boolean> {
  // Load the controller only when an authenticated transition actually runs. This keeps demo and
  // isolated component tests from initializing the server-persistence owner merely by importing a
  // picker component, and avoids a cycle through the account-summary refresh helper.
  const { masqueradeController } = await import("./masqueradeController");
  return masqueradeController.transitionAccount(accountId);
}
